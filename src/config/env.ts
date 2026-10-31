/**
 * Single source of truth for runtime configuration.
 *
 * Loads an optional `.env` file with a tiny parser. Node 21.6 has neither
 * `--env-file-if-exists` nor `process.loadEnvFile`, and we deliberately avoid
 * dotenv. Variables already present in `process.env` always win, so CI
 * secrets and shell exports override the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(file = resolve(__dirname, '../../.env')): void {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

// Pin a random seed in the runner process so every worker (which inherits process.env) shares it.
if (!process.env.TEST_SEED?.trim()) process.env.TEST_SEED = String(Date.now() % 1_000_000);

const PUBLIC_HOST = 'parabank.parasoft.com';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Env var ${name} must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** Normalises to an absolute URL that ends with `/parabank/` style trailing slash. */
function normaliseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`BASE_URL must be an absolute URL, got "${raw}"`);
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

const isCI = bool('CI', false);
const baseUrl = normaliseBaseUrl(str('BASE_URL', `https://${PUBLIC_HOST}/parabank/`));
const isPublicSite = new URL(baseUrl).hostname === PUBLIC_HOST;

const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export type BrowserName = (typeof BROWSERS)[number];

function browsers(): BrowserName[] {
  const list = str('BROWSERS', 'chromium')
    .split(',')
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean);
  for (const b of list) {
    if (!(BROWSERS as readonly string[]).includes(b)) {
      throw new Error(`BROWSERS contains unknown browser "${b}" (allowed: ${BROWSERS.join(', ')})`);
    }
  }
  return list as BrowserName[];
}

export const env = {
  isCI,
  /** UI root, always with trailing slash, e.g. https://parabank.parasoft.com/parabank/ */
  baseUrl,
  /** REST root (no auth, JSON with Accept header), e.g. .../parabank/services/bank/ */
  apiBaseUrl: new URL('services/bank/', baseUrl).toString(),
  /** True when targeting the shared, Cloudflare-protected public instance. */
  isPublicSite,
  /** Seed for faker. Logged and annotated on every test for reproducibility. */
  testSeed: int('TEST_SEED', 0),
  browsers: browsers(),
  /** Public site: 1 worker (Cloudflare budget). Self-hosted: 4. */
  workers: int('WORKERS', isPublicSite ? 1 : 4),
  retries: int('RETRIES', isCI ? 1 : 0),
  /**
   * Client-side request budget (requests per 60 s that actually hit the network), enforced as a
   * leaky bucket at test boundaries plus a sliding-window ceiling. 0 disables pacing.
   * Public default 60: 25% below the lowest observed Cloudflare trip (~80/min).
   */
  rateLimitRpm: int('RATE_LIMIT_RPM', isPublicSite ? 60 : 0),
  /** Headroom (requests) each test waits for before starting; about the p90 cost of a test. */
  rateLimitTestBudget: int('RATE_LIMIT_TEST_BUDGET', 20),
  /**
   * Long-window cap (hypothesis, unverified): at most RATE_LIMIT_LONG_MAX requests per
   * RATE_LIMIT_LONG_WINDOW_S, aimed at Cloudflare's slower cumulative trips. 0 disables.
   */
  rateLimitLongWindowSec: int('RATE_LIMIT_LONG_WINDOW_S', isPublicSite ? 600 : 0),
  rateLimitLongMax: int('RATE_LIMIT_LONG_MAX', isPublicSite ? 450 : 0),
  /**
   * Max seconds we are willing to wait on a 429 Retry-After or a challenge cool-down before
   * failing with RATE_LIMITED / CF_CHALLENGE. Bans run ~180-300 s; use 330 for unattended jobs.
   */
  rateLimitMaxWaitSec: int('RATE_LIMIT_MAX_WAIT_S', 60),
  /** Delay before the single replay of an HTTP request that got a Cloudflare challenge. */
  cfChallengeRetryDelaySec: int('CF_CHALLENGE_RETRY_DELAY_S', 30),
  /** After a challenge/block that survived the replay, stop sending traffic for this long. */
  cfChallengeCooldownSec: int('CF_CHALLENGE_COOLDOWN_S', 120),
  /**
   * Pacing/ban/cool-down state, persisted so it survives worker restarts and consecutive runs.
   * One file per target host. Not under test-results/ (Playwright wipes that at start).
   */
  rateLimitStateFile: resolve(
    __dirname,
    '../..',
    str(
      'RATE_LIMIT_STATE_FILE',
      `.cache/rate-limit-${new URL(baseUrl).host.replace(/[^\w.-]/g, '_')}.json`,
    ),
  ),
  /** Block images/fonts/media to cut ~75% of requests (Cloudflare budget). */
  blockStaticAssets: bool('BLOCK_STATIC_ASSETS', true),
  /** Serve same-origin CSS/JS from a per-worker memory cache after the first fetch. */
  cacheStaticAssets: bool('CACHE_STATIC_ASSETS', true),
  headless: !bool('HEADED', false),
  /** Whole-run guard in minutes (perf doc: 20 local / 30 CI). */
  globalTimeoutMin: int('GLOBAL_TIMEOUT_MIN', isCI ? 30 : 20),
} as const;

export type Env = typeof env;
