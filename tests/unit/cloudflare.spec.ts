/**
 * Network-free unit tests for Cloudflare classification, the persisted rate-limit state and the
 * guarded-HTTP retry rules. They use no page/context fixture, so no browser is launched.
 * Rows of the classification table: docs/evidence/TEST-RESULTS-ANALYSIS.md section 2.3.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIResponse } from '@playwright/test';
import { env } from '@src/config/env';
import { classifyFailure } from '@src/fixtures/test';
import {
  CloudflareBlockedError,
  RateLimitedError,
  banRemainingSec,
  cloudflareCooldownRemainingSec,
  classifyCloudflare,
  cloudflareError,
  noteCustomerId,
  recordCloudflare,
  recordRateLimit,
  refreshState,
  sendGuarded,
  settleAfterTest,
  useStateFileForTests,
  waitForBanOrFail,
} from '@src/support/rate-limit';

const CF = { server: 'cloudflare', 'cf-ray': 'a531a8b07f793b1f-BOM' };

function freshStateFile(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'pb-rl-')), 'state.json');
  useStateFileForTests(file);
  return file;
}

/** Minimal APIResponse stand-in for sendGuarded. */
function fakeResponse(status: number, headers: Record<string, string>, body = ''): APIResponse {
  return {
    status: () => status,
    headers: () => headers,
    text: () => Promise.resolve(body),
    url: () => 'https://parabank.example/parabank/register.htm',
  } as unknown as APIResponse;
}

test.describe('classifyCloudflare', { tag: '@unit' }, () => {
  const rows: {
    name: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    expected: ReturnType<typeof classifyCloudflare>;
  }[] = [
    {
      name: '429 API 1015 [measured]',
      status: 429,
      headers: { ...CF, 'retry-after': '288' },
      body: 'error code: 1015',
      expected: 'rate-limit',
    },
    {
      name: '429 page interstitial [measured]',
      status: 429,
      headers: { ...CF, 'retry-after': '184' },
      body: 'Access denied | parabank.parasoft.com used Cloudflare to restrict access\nYou are being rate limited',
      expected: 'rate-limit',
    },
    {
      name: '403 cf-mitigated: challenge [measured]',
      status: 403,
      headers: { ...CF, 'cf-mitigated': 'challenge' },
      body: '<html>',
      expected: 'challenge',
    },
    {
      name: '403 "Just a moment" without header',
      status: 403,
      headers: CF,
      body: '<title>Just a moment...</title><script>window._cf_chl_opt={}</script>',
      expected: 'challenge',
    },
    {
      name: '503 legacy browser check',
      status: 503,
      headers: CF,
      body: 'Enable JavaScript and cookies to continue',
      expected: 'challenge',
    },
    {
      name: '403 WAF block',
      status: 403,
      headers: CF,
      body: '<title>Attention Required! | Cloudflare</title> Sorry, you have been blocked',
      expected: 'block',
    },
    {
      name: '403 error code 1020',
      status: 403,
      headers: CF,
      body: 'error code: 1020',
      expected: 'block',
    },
    {
      name: 'ParaBank 500 internal error',
      status: 500,
      headers: CF,
      body: 'An internal error has occurred and has been logged.',
      expected: null,
    },
    {
      name: '403 not via Cloudflare',
      status: 403,
      headers: { server: 'Apache-Coyote/1.1' },
      body: 'Just a moment',
      expected: null,
    },
    {
      name: '403 via Cloudflare, no markers',
      status: 403,
      headers: CF,
      body: 'Forbidden',
      expected: null,
    },
    {
      name: '200 normal page',
      status: 200,
      headers: CF,
      body: '<title>ParaBank | Welcome</title>',
      expected: null,
    },
  ];
  for (const row of rows) {
    test(row.name, () => {
      expect(classifyCloudflare(row.status, row.headers, row.body)).toBe(row.expected);
    });
  }

  test('maps verdicts to distinct, coded errors', () => {
    const rate = cloudflareError(429, { ...CF, 'retry-after': '200' }, '', 'u');
    expect(rate).toBeInstanceOf(RateLimitedError);
    expect(rate?.message).toMatch(/^RATE_LIMITED: .*Retry-After=200s/);

    const challenge = cloudflareError(403, { ...CF, 'cf-mitigated': 'challenge' }, '', 'u');
    expect(challenge).toBeInstanceOf(CloudflareBlockedError);
    expect(challenge?.code).toBe('CF_CHALLENGE');
    expect(challenge?.message).toMatch(
      /^CF_CHALLENGE: Cloudflare answered 403 for u \(cf-mitigated=challenge\)/,
    );

    const block = cloudflareError(403, CF, 'Sorry, you have been blocked', 'u');
    expect(block?.code).toBe('CF_BLOCK');
    expect(cloudflareError(200, CF, '', 'u')).toBeNull();
  });
});

test.describe('persisted rate-limit state', { tag: '@unit' }, () => {
  test('a ban recorded by one process is seen after a reload from disk', () => {
    const file = freshStateFile();
    recordRateLimit(200, 'https://x/ban');
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as {
      bannedUntil: number;
      lastBanUrl: string;
    };
    expect(onDisk.lastBanUrl).toBe('https://x/ban');

    useStateFileForTests(file); // forget memory, as a restarted worker or a new run would
    expect(banRemainingSec()).toBe(0);
    refreshState();
    expect(banRemainingSec()).toBeGreaterThanOrEqual(199);
  });

  test('a challenge cool-down longer than the wait cap fails fast as CF_CHALLENGE', async () => {
    // eslint-disable-next-line playwright/no-skipped-test -- env-dependent precondition, not a disabled test
    test.skip(env.cfChallengeCooldownSec <= env.rateLimitMaxWaitSec, 'cool-down fits the wait cap');
    freshStateFile();
    recordCloudflare(
      new CloudflareBlockedError('challenge', 'https://x/reg', 403, 'cf-mitigated=challenge'),
    );
    await expect(waitForBanOrFail()).rejects.toThrow(/^CF_CHALLENGE: .*cool-down \d+s left/);
  });

  test('leaky bucket: a test owes cost * 60 s / rpm minus its duration', () => {
    // eslint-disable-next-line playwright/no-skipped-test -- env-dependent precondition, not a disabled test
    test.skip(env.rateLimitRpm === 0, 'pacing disabled for this BASE_URL');
    const file = freshStateFile();
    const before = Date.now();
    settleAfterTest(env.rateLimitRpm / 10, 1_000); // 6 s of budget at any rpm, 1 s already spent
    const { debtUntil } = JSON.parse(readFileSync(file, 'utf8')) as { debtUntil: number };
    expect(debtUntil - before).toBeGreaterThanOrEqual(4_900);
    expect(debtUntil - before).toBeLessThan(5_500);
  });

  test('DB-reset canary: a lower customer id than seen before is reported once', () => {
    freshStateFile();
    expect(noteCustomerId(17_540)).toBeNull();
    expect(noteCustomerId(17_651)).toBeNull();
    expect(noteCustomerId(14_099)).toBe(17_651);
    expect(noteCustomerId(14_210)).toBeNull(); // baseline lowered after the reset
  });
});

test.describe('sendGuarded retry rules', { tag: '@unit' }, () => {
  const challenge = () => fakeResponse(403, { ...CF, 'cf-mitigated': 'challenge' }, '<html>');

  test('replays a managed challenge exactly once, then succeeds', async () => {
    freshStateFile();
    const answers = [challenge(), fakeResponse(200, CF, 'ok')];
    let calls = 0;
    const res = await sendGuarded(() => Promise.resolve(answers[calls++]), 1, 10);
    expect(calls).toBe(2);
    expect(res.status()).toBe(200);
    expect(test.info().annotations.map((a) => a.type)).toContain('cf-challenge-replayed');
  });

  test('a second challenge throws CF_CHALLENGE and starts the cool-down', async () => {
    freshStateFile();
    let calls = 0;
    const attempt = sendGuarded(
      () => {
        calls++;
        return Promise.resolve(challenge());
      },
      1,
      10,
    );
    await expect(attempt).rejects.toThrow(/^CF_CHALLENGE:/);
    expect(calls).toBe(2);
    expect(cloudflareCooldownRemainingSec()).toBeGreaterThan(0);
  });

  test('a 429 longer than the wait cap throws RATE_LIMITED without a retry', async () => {
    freshStateFile();
    let calls = 0;
    const attempt = sendGuarded(() => {
      calls++;
      return Promise.resolve(
        fakeResponse(
          429,
          { ...CF, 'retry-after': String(env.rateLimitMaxWaitSec + 100) },
          'error code: 1015',
        ),
      );
    });
    await expect(attempt).rejects.toThrow(/^RATE_LIMITED:/);
    expect(calls).toBe(1);
  });

  test('non-Cloudflare statuses pass through untouched', async () => {
    freshStateFile();
    const res = await sendGuarded(() =>
      Promise.resolve(fakeResponse(500, CF, 'An internal error has occurred')),
    );
    expect(res.status()).toBe(500);
  });
});

test.describe('classifyFailure', { tag: '@unit' }, () => {
  const failed = (message: string) => ({
    status: 'failed' as const,
    expectedStatus: 'passed' as const,
    errors: [{ message }],
  });

  test('labels failures by class A-E', () => {
    expect(classifyFailure(failed('RATE_LIMITED: Cloudflare returned 429'), undefined)).toBe(
      'A RATE_LIMITED',
    );
    expect(classifyFailure(failed('CF_CHALLENGE: Cloudflare answered 403'), undefined)).toBe(
      'B CF_CHALLENGE',
    );
    expect(classifyFailure(failed('CF_BLOCK: Cloudflare answered 403'), undefined)).toBe(
      'B CF_BLOCK',
    );
    expect(classifyFailure(failed('DB_RESET_SUSPECTED: customer 1 vanished'), undefined)).toBe(
      'C DB_RESET_SUSPECTED',
    );
    expect(
      classifyFailure(
        failed('expect(locator).toHaveText(expected) failed\nExpected: "a"\nReceived: "b"'),
        undefined,
      ),
    ).toBe('D ASSERTION');
    expect(
      classifyFailure(
        failed(
          'expect(locator).toBeVisible() failed\nExpected: visible\nError: element(s) not found',
        ),
        undefined,
      ),
    ).toBe('E TEST_OR_FRAMEWORK');
    expect(classifyFailure(failed('TypeError: x is undefined'), undefined)).toBe(
      'E TEST_OR_FRAMEWORK',
    );
    expect(
      classifyFailure({ status: 'passed', expectedStatus: 'passed', errors: [] }, undefined),
    ).toBeNull();
  });
});
