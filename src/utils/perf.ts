import type { Page, TestInfo } from '@playwright/test';

export interface NavTiming {
  ttfb: number;
  domContentLoaded: number;
  load: number;
  lcp: number | null;
}

/** Budgets (ms) from docs/discovery/05-performance-baseline.md section 6: about 4-5x the measured max. */
export const Budgets = {
  ttfb: 1_500,
  domContentLoadedIndex: 5_000,
  domContentLoaded: 2_000,
  load: 5_000,
  lcp: 4_000,
  dropdownReady: 3_000,
  action: 4_000,
  login: 5_000,
  restAccounts: 2_000,
} as const;

/**
 * Reads Navigation Timing for the current document and the latest LCP entry.
 * LCP is read from a buffered PerformanceObserver, which returns already-recorded entries
 * immediately, so no artificial delay is needed. Note: images are blocked by default
 * (BLOCK_STATIC_ASSETS), so LCP is usually a text block.
 */
export async function readNavTiming(page: Page): Promise<NavTiming> {
  await page.waitForLoadState('load');
  return page.evaluate(async () => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const lcp = await new Promise<number | null>((resolve) => {
      let latest: number | null = null;
      try {
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) latest = e.startTime;
        });
        po.observe({ type: 'largest-contentful-paint', buffered: true });
        // Buffered entries are delivered in a task right after observe(); yield one frame.
        requestAnimationFrame(() =>
          setTimeout(() => {
            po.disconnect();
            resolve(latest);
          }, 0),
        );
      } catch {
        resolve(null);
      }
    });
    return {
      ttfb: Math.round(nav.responseStart - nav.startTime),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      load: Math.round(nav.loadEventEnd - nav.startTime),
      lcp: lcp === null ? null : Math.round(lcp),
    };
  });
}

/** Wall-clock duration of an async action in ms. */
export async function timed(action: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await action();
  return Math.round(performance.now() - start);
}

export async function attachMetrics(
  testInfo: TestInfo,
  name: string,
  metrics: object,
): Promise<void> {
  await testInfo.attach(`perf-${name}.json`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  testInfo.annotations.push({ type: 'perf', description: `${name}: ${JSON.stringify(metrics)}` });
}
