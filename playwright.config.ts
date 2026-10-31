import { defineConfig, devices, type Project } from '@playwright/test';
import { env } from './src/config/env';

/**
 * Timeouts come from docs/discovery/05-performance-baseline.md section 5 (about 5-10x the measured p50,
 * local vs CI). Workers default to 1 on the Cloudflare-protected public site and 4 on a
 * self-hosted instance. Override any of them via env (see .env.example).
 */
const ci = env.isCI;
const minutes = (m: number) => m * 60_000;

const desktop = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

const NOT_E2E = /@a11y|@perf|@unit/;

const e2eProjects: Project[] = env.browsers.map((browser) => ({
  name: browser,
  use: { ...desktop[browser] },
  grepInvert: NOT_E2E,
}));

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: ci,
  retries: env.retries,
  workers: env.workers,
  timeout: ci ? 90_000 : 60_000,
  globalTimeout: minutes(env.globalTimeoutMin),
  expect: { timeout: ci ? 10_000 : 7_000 },
  reporter: ci
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: env.baseUrl,
    headless: env.headless,
    timezoneId: 'UTC',
    locale: 'en-US',
    actionTimeout: ci ? 15_000 : 10_000,
    navigationTimeout: ci ? 30_000 : 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      // Network-free logic tests (no page/context fixture, so no browser is launched).
      name: 'unit',
      testDir: './tests/unit',
      grep: /@unit/,
      retries: 0,
      use: { trace: 'off', video: 'off', screenshot: 'off' },
    },
    ...e2eProjects,
    {
      name: 'a11y',
      use: { ...devices['Desktop Chrome'] },
      grep: /@a11y/,
    },
    {
      // Budgets are only meaningful without contention: run sequentially in file order.
      name: 'perf',
      use: { ...devices['Desktop Chrome'], trace: 'off', video: 'off' },
      grep: /@perf/,
      fullyParallel: false,
      retries: 0,
    },
  ],
});
