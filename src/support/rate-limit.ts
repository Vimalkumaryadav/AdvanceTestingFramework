/**
 * Cloudflare protection handling shared by the browser fixture, the page objects, HTTP
 * registration and the API client.
 *
 * The public ParaBank instance sits behind Cloudflare, which answers in three observed or
 * documented ways (docs/evidence/TEST-RESULTS-ANALYSIS.md section 2.3):
 *   - 429 / "error code: 1015" with Retry-After 180-300 s           -> RATE_LIMITED
 *   - 403 with `cf-mitigated: challenge` (managed challenge)        -> CF_CHALLENGE
 *   - 403 "Attention Required! | Cloudflare" / error 1020 (WAF)     -> CF_BLOCK
 *
 * Defences:
 *   1. Pacing: a leaky bucket at test boundaries (each test "pays" cost*60/rpm seconds),
 *      plus two sliding-window ceilings (RATE_LIMIT_RPM per 60 s, RATE_LIMIT_LONG_MAX per
 *      RATE_LIMIT_LONG_WINDOW_S).
 *   2. A ban clock (429) and a challenge cool-down (403): later traffic waits them out
 *      within RATE_LIMIT_MAX_WAIT_S or fails fast with a distinct, classified error.
 *
 * State is persisted to a JSON file (one per target host), so it survives Playwright's
 * worker restart after a failure and carries over between consecutive runs. Writes are
 * best-effort read-merge-write, which is exact for the default single worker.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, type APIResponse, type TestInfo } from '@playwright/test';
import { env } from '../config/env';

// ---------------------------------------------------------------- errors

export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED';
  constructor(
    readonly retryAfterSec: number,
    readonly url: string,
  ) {
    super(
      `RATE_LIMITED: Cloudflare returned 429 (Error 1015) for ${url}; Retry-After=${retryAfterSec}s ` +
        `exceeds RATE_LIMIT_MAX_WAIT_S=${env.rateLimitMaxWaitSec}s. This is an infrastructure limit, ` +
        `not a product defect. Lower WORKERS / RATE_LIMIT_RPM or point BASE_URL at a self-hosted ParaBank.`,
    );
    this.name = 'RateLimitedError';
  }
}

export type CloudflareKind = 'challenge' | 'block';

export class CloudflareBlockedError extends Error {
  readonly code: 'CF_CHALLENGE' | 'CF_BLOCK';
  constructor(
    readonly kind: CloudflareKind,
    readonly url: string,
    readonly status: number,
    readonly evidence: string,
  ) {
    const code = kind === 'challenge' ? 'CF_CHALLENGE' : 'CF_BLOCK';
    super(
      `${code}: Cloudflare answered ${status} for ${url} (${evidence}). Bot protection, not a ` +
        `product defect and not a Retry-After rate limit. Wait several minutes, lower ` +
        `RATE_LIMIT_RPM, or use a self-hosted BASE_URL.`,
    );
    this.code = code;
    this.name = 'CloudflareBlockedError';
  }
}

/** Any infrastructure error raised by this module. */
export type InfraError = RateLimitedError | CloudflareBlockedError;

export function isInfraError(e: unknown): e is InfraError {
  return e instanceof RateLimitedError || e instanceof CloudflareBlockedError;
}

// ---------------------------------------------------------------- classification

export type CloudflareVerdict = 'rate-limit' | 'challenge' | 'block' | null;

const RATE_LIMIT_MARKERS = /error code: 1015|Error 1015|You are being rate limited/i;
const CHALLENGE_MARKERS =
  /Just a moment|Enable JavaScript and cookies to continue|Performing security verification|\/cdn-cgi\/challenge-platform|_cf_chl_opt|cf-chl-|challenges\.cloudflare\.com/i;
const BLOCK_MARKERS =
  /Attention Required! \| Cloudflare|Sorry, you have been blocked|error code: 10(0[5-9]|1\d|20)\b/i;

/** Statuses for which a body/title is worth reading for classification. */
export const CLOUDFLARE_STATUSES: readonly number[] = [403, 429, 503];

/**
 * Header-first, body-second classification of a response. Header names must be lower case
 * (Playwright's `headers()` already is). 403/503 are only attributed to Cloudflare when the
 * response came through Cloudflare (`server: cloudflare` or a `cf-ray` header), so a genuine
 * ParaBank 403/503 is not mislabelled.
 */
export function classifyCloudflare(
  status: number,
  headers: Record<string, string>,
  bodyOrTitle = '',
): CloudflareVerdict {
  if (status === 429 || RATE_LIMIT_MARKERS.test(bodyOrTitle)) return 'rate-limit';
  const viaCloudflare = /cloudflare/i.test(headers['server'] ?? '') || Boolean(headers['cf-ray']);
  if (!viaCloudflare) return null;
  if ((headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return 'challenge';
  if ((status === 403 || status === 503) && CHALLENGE_MARKERS.test(bodyOrTitle)) return 'challenge';
  if (status === 403 && BLOCK_MARKERS.test(bodyOrTitle)) return 'block';
  return null;
}

/** Converts a classified response into the matching error, or null for a normal response. */
export function cloudflareError(
  status: number,
  headers: Record<string, string>,
  bodyOrTitle: string,
  url: string,
): InfraError | null {
  const verdict = classifyCloudflare(status, headers, bodyOrTitle);
  if (verdict === 'rate-limit')
    return new RateLimitedError(parseRetryAfter(headers['retry-after']), url);
  if (verdict) {
    const evidence = headers['cf-mitigated']
      ? `cf-mitigated=${headers['cf-mitigated']}`
      : `server=${headers['server'] ?? '?'}, cf-ray=${headers['cf-ray'] ?? '?'}`;
    return new CloudflareBlockedError(verdict, url, status, evidence);
  }
  return null;
}

/**
 * Throws RATE_LIMITED / CF_CHALLENGE / CF_BLOCK for a Cloudflare response and records it in
 * the persisted state (ban clock or challenge cool-down). Returns normally otherwise.
 */
export function throwIfCloudflare(
  status: number,
  headers: Record<string, string>,
  bodyOrTitle: string,
  url: string,
): void {
  const error = cloudflareError(status, headers, bodyOrTitle, url);
  if (!error) return;
  recordInfraError(error);
  throw error;
}

/** Kept for compatibility: true when the response is a Cloudflare rate limit. */
export function isRateLimited(
  status: number,
  bodyOrTitle = '',
  headers: Record<string, string> = {},
): boolean {
  return classifyCloudflare(status, headers, bodyOrTitle) === 'rate-limit';
}

/** Parses Retry-After (seconds or HTTP date). Falls back to 300 s, Cloudflare's typical ban. */
export function parseRetryAfter(header: string | undefined | null): number {
  if (!header) return 300;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
  const at = Date.parse(header);
  return Number.isNaN(at) ? 300 : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

// ---------------------------------------------------------------- persisted state

interface State {
  /** Timestamps (ms) of requests that reached the network. */
  sent: number[];
  bannedUntil: number;
  lastBanUrl: string;
  cfCooldownUntil: number;
  cfKind: CloudflareKind | '';
  cfUrl: string;
  cfStatus: number;
  cfEvidence: string;
  /** Leaky-bucket: the next test may not start before this time. */
  debtUntil: number;
  /** Highest customer id seen (ids only grow; a lower one means the DB was re-initialised). */
  lastCustomerId: number;
}

const emptyState = (): State => ({
  sent: [],
  bannedUntil: 0,
  lastBanUrl: '',
  cfCooldownUntil: 0,
  cfKind: '',
  cfUrl: '',
  cfStatus: 0,
  cfEvidence: '',
  debtUntil: 0,
  lastCustomerId: 0,
});

const SHORT_WINDOW_MS = 60_000;
const FLUSH_EVERY = 20;

let stateFile = env.rateLimitStateFile;
/** Last view of the shared state (disk merged with this process's scalar updates). */
let state: State = emptyState();
/** Requests recorded by this process and not yet written to disk. */
let pending: number[] = [];
let apiRequests = 0;

const keepMs = () => Math.max(SHORT_WINDOW_MS, env.rateLimitLongWindowSec * 1000);
const recent = (ts: number[]) => {
  const cutoff = Date.now() - keepMs();
  return ts.filter((t) => t > cutoff);
};

function readDisk(): State {
  try {
    return { ...emptyState(), ...(JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<State>) };
  } catch {
    return emptyState();
  }
}

/** Scalars: keep whichever ban / cool-down ends later. `sent` comes from disk. */
function mergeScalars(disk: State): State {
  const ban = disk.bannedUntil > state.bannedUntil ? disk : state;
  const cf = disk.cfCooldownUntil > state.cfCooldownUntil ? disk : state;
  return {
    sent: recent(disk.sent),
    bannedUntil: ban.bannedUntil,
    lastBanUrl: ban.lastBanUrl,
    cfCooldownUntil: cf.cfCooldownUntil,
    cfKind: cf.cfKind,
    cfUrl: cf.cfUrl,
    cfStatus: cf.cfStatus,
    cfEvidence: cf.cfEvidence,
    debtUntil: Math.max(disk.debtUntil, state.debtUntil),
    lastCustomerId: Math.max(disk.lastCustomerId, state.lastCustomerId),
  };
}

/** Re-reads the state file (other workers, earlier runs) into memory. */
export function refreshState(): void {
  state = mergeScalars(readDisk());
}

/** Writes disk + this process's pending requests + scalars (write-temp-then-rename). Never throws. */
function flushState(overrideCustomerId?: number): void {
  // overrideCustomerId lets noteCustomerId() LOWER the stored id after a DB reset.
  try {
    const next = mergeScalars(readDisk());
    next.sent = recent([...next.sent, ...pending]).sort((a, b) => a - b);
    if (overrideCustomerId !== undefined) next.lastCustomerId = overrideCustomerId;
    mkdirSync(dirname(stateFile), { recursive: true });
    const tmp = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next));
    try {
      renameSync(tmp, stateFile);
    } catch {
      writeFileSync(stateFile, JSON.stringify(next)); // Windows: target briefly locked
    }
    state = next;
    pending = [];
  } catch {
    // Persisting is best effort; pacing still works from memory + pending.
  }
}

/** Persists pending state now (called at the end of every test). */
export function persistState(): void {
  flushState();
}

/** Test hook: point the module at another state file and forget in-memory state. */
export function useStateFileForTests(path: string): void {
  stateFile = resolve(path);
  state = emptyState();
  pending = [];
}

refreshState();

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function currentTestInfo(): TestInfo | undefined {
  try {
    return test.info();
  } catch {
    return undefined; // worker-scoped fixture or a plain script
  }
}

/** Extends the current test's timeout by `ms` when called inside a test (no-op otherwise). */
function extendTestTimeout(ms: number): void {
  const info = currentTestInfo();
  if (ms > 0 && info) info.setTimeout(info.timeout + ms);
}

// ---------------------------------------------------------------- ban clock / cool-down

export function recordRateLimit(retryAfterSec: number, url: string): void {
  state.bannedUntil = Math.max(state.bannedUntil, Date.now() + retryAfterSec * 1000);
  state.lastBanUrl = url;
  flushState();
}

export function recordCloudflare(error: CloudflareBlockedError): void {
  state.cfCooldownUntil = Date.now() + env.cfChallengeCooldownSec * 1000;
  state.cfKind = error.kind;
  state.cfUrl = error.url;
  state.cfStatus = error.status;
  state.cfEvidence = error.evidence;
  flushState();
}

export function recordInfraError(error: InfraError): void {
  if (error instanceof RateLimitedError) recordRateLimit(error.retryAfterSec, error.url);
  else recordCloudflare(error);
}

/** Seconds left on the current 429 ban (0 when not banned). */
export function banRemainingSec(): number {
  return Math.max(0, Math.ceil((state.bannedUntil - Date.now()) / 1000));
}

/** Seconds left on the current challenge/block cool-down (0 when none). */
export function cloudflareCooldownRemainingSec(): number {
  return Math.max(0, Math.ceil((state.cfCooldownUntil - Date.now()) / 1000));
}

/** Seconds until traffic may resume (max of ban and cool-down), after re-reading disk state. */
export function blockedRemainingSec(): number {
  refreshState();
  return Math.max(banRemainingSec(), cloudflareCooldownRemainingSec());
}

/**
 * Called before a test or request: waits out a known ban or challenge cool-down if it fits
 * within RATE_LIMIT_MAX_WAIT_S, otherwise throws the stored, classified error immediately
 * (instead of sending traffic into a live block and producing a misleading timeout).
 */
export async function waitForBanOrFail(): Promise<void> {
  refreshState();
  const ban = banRemainingSec();
  const cf = cloudflareCooldownRemainingSec();
  const remaining = Math.max(ban, cf);
  if (remaining === 0) return;
  if (remaining > env.rateLimitMaxWaitSec) {
    if (ban >= cf) throw new RateLimitedError(ban, state.lastBanUrl);
    throw new CloudflareBlockedError(
      state.cfKind || 'challenge',
      state.cfUrl,
      state.cfStatus,
      `${state.cfEvidence}; cool-down ${cf}s left (CF_CHALLENGE_COOLDOWN_S)`,
    );
  }
  extendTestTimeout(remaining * 1000);
  await delay(remaining * 1000);
}

// ---------------------------------------------------------------- pacing

/** All known request timestamps, ascending (persisted + this process's pending). */
function allSent(): number[] {
  return pending.length ? [...state.sent, ...pending].sort((a, b) => a - b) : state.sent;
}

/** Records a request that already went to the network. Never blocks. */
export function recordRequest(): void {
  if (env.rateLimitRpm <= 0 && env.rateLimitLongMax <= 0) return;
  pending.push(Date.now());
  if (pending.length >= FLUSH_EVERY) flushState();
}

/** Milliseconds until `want` more requests fit in a window of `windowMs` holding at most `max`. */
function waitNeeded(windowMs: number, max: number, want: number, now: number): number {
  if (max <= 0 || windowMs <= 0) return 0;
  const inWindow = allSent().filter((t) => t > now - windowMs);
  const over = inWindow.length + Math.min(want, max) - max;
  if (over <= 0) return 0;
  // The `over` oldest in-window entries must age out.
  return inWindow[over - 1] + windowMs - now + 5;
}

/**
 * Waits until both sliding windows have room for `needed` more requests and returns the ms
 * waited. A hard ceiling only; the leaky bucket (paceBeforeTest) does the smoothing.
 * Never used to wait for application state.
 */
export async function waitForHeadroom(needed = 1): Promise<number> {
  if (env.rateLimitRpm <= 0 && env.rateLimitLongMax <= 0) return 0;
  const start = Date.now();
  for (;;) {
    refreshState();
    const now = Date.now();
    const wait = Math.max(
      env.rateLimitRpm > 0 ? waitNeeded(SHORT_WINDOW_MS, env.rateLimitRpm, needed, now) : 0,
      waitNeeded(env.rateLimitLongWindowSec * 1000, env.rateLimitLongMax, needed, now),
    );
    if (wait <= 0) return Date.now() - start;
    await delay(wait);
  }
}

/** Throttle for API/HTTP calls made inside a test: room for one request, then record it. */
export async function acquireRequestSlot(): Promise<number> {
  const waited = await waitForHeadroom(1);
  extendTestTimeout(waited);
  recordRequest();
  apiRequests++;
  return waited;
}

/** Number of API/HTTP requests sent through acquireRequestSlot by this process. */
export function apiRequestCount(): number {
  return apiRequests;
}

/**
 * Before a test: pay the previous test's leaky-bucket debt, then make sure the windows have
 * room for a typical test. Returns the ms waited.
 */
export async function paceBeforeTest(budget = env.rateLimitTestBudget): Promise<number> {
  if (env.rateLimitRpm <= 0) return 0;
  refreshState();
  const start = Date.now();
  const debt = state.debtUntil - start;
  if (debt > 0) await delay(debt);
  await waitForHeadroom(budget);
  return Date.now() - start;
}

/**
 * After a test: a test that sent `cost` requests in `durationMs` owes
 * `cost * 60 s / RATE_LIMIT_RPM - durationMs` of idle time before the next test starts.
 * Same average rate as the window, without burst-then-stall cycles.
 */
export function settleAfterTest(cost: number, durationMs: number): void {
  if (env.rateLimitRpm > 0) {
    const owed = (cost * 60_000) / env.rateLimitRpm - durationMs;
    state.debtUntil = Math.max(state.debtUntil, Date.now() + Math.max(0, owed));
  }
  flushState();
}

// ---------------------------------------------------------------- DB reset canary

/**
 * Records a freshly registered customer id. Returns the previously highest id when the new
 * one is LOWER (ParaBank ids only grow, so the shared DB was re-initialised since), else null.
 */
export function noteCustomerId(id: number): number | null {
  refreshState();
  const previous = state.lastCustomerId;
  flushState(id < previous ? id : Math.max(previous, id));
  return id < previous ? previous : null;
}

// ---------------------------------------------------------------- guarded HTTP

/**
 * Sends one HTTP call (APIRequestContext) with ban/cool-down checks and pacing, and classifies
 * Cloudflare answers. Every other status is returned to the caller unchanged.
 *  - 429 whose Retry-After fits RATE_LIMIT_MAX_WAIT_S: waited out and retried once.
 *  - Managed challenge: replayed ONCE after CF_CHALLENGE_RETRY_DELAY_S. Cloudflare answered
 *    before the origin, so even a POST is safe to replay.
 *  - Anything else classified (or a second hit): throws RATE_LIMITED / CF_CHALLENGE / CF_BLOCK
 *    and records the ban clock / cool-down so later traffic stops.
 */
export async function sendGuarded(
  call: () => Promise<APIResponse>,
  retriesLeft = 1,
  challengeDelayMs = env.cfChallengeRetryDelaySec * 1000,
): Promise<APIResponse> {
  await waitForBanOrFail();
  await acquireRequestSlot();
  const res = await call();
  if (!CLOUDFLARE_STATUSES.includes(res.status())) return res;
  const error = cloudflareError(res.status(), res.headers(), await res.text(), res.url());
  if (!error) return res;
  if (retriesLeft > 0 && error instanceof RateLimitedError) {
    recordInfraError(error); // the ban clock makes waitForBanOrFail() sleep before the retry
    if (error.retryAfterSec > env.rateLimitMaxWaitSec) throw error;
    return sendGuarded(call, retriesLeft - 1, challengeDelayMs);
  }
  if (retriesLeft > 0 && error instanceof CloudflareBlockedError && error.kind === 'challenge') {
    // One delayed replay before the cool-down is recorded; a second challenge records + throws.
    const wait = challengeDelayMs;
    const sleep = () => delay(wait);
    const info = currentTestInfo();
    if (info) {
      info.setTimeout(info.timeout + wait);
      info.annotations.push({ type: 'cf-challenge-replayed', description: res.url() });
      await test.step(
        `[cloudflare] challenge on ${res.url()}: replay once after ${wait / 1000}s`,
        sleep,
      );
    } else {
      await sleep();
    }
    return sendGuarded(call, retriesLeft - 1, challengeDelayMs);
  }
  recordInfraError(error);
  throw error;
}
