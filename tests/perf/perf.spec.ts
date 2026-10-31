import { expect, test } from '@src/fixtures';
import { Budgets, attachMetrics, readNavTiming, timed, type NavTiming } from '@src/utils/perf';
import type { BasePage } from '@src/pages';

/*
 * Lightweight performance budgets (docs/discovery/05 section 6). Budgets are about 4-5x the measured max,
 * asserted with expect.soft so every metric is reported. Runs in the serial `perf` project.
 * Absolute numbers depend on network location; treat failures as a signal to investigate.
 */
function assertNav(name: string, t: NavTiming, dclBudget: number): void {
  expect.soft(t.ttfb, `${name} TTFB`).toBeLessThan(Budgets.ttfb);
  expect.soft(t.domContentLoaded, `${name} DOMContentLoaded`).toBeLessThan(dclBudget);
  expect.soft(t.load, `${name} load`).toBeLessThan(Budgets.load);
  if (t.lcp !== null) expect.soft(t.lcp, `${name} LCP`).toBeLessThan(Budgets.lcp);
}

test.describe('Performance budgets', () => {
  test(
    'public pages load within budget',
    { tag: '@perf' },
    async ({ homePage, registerPage }, testInfo) => {
      await homePage.goto();
      const index = await readNavTiming(homePage.page);
      assertNav('index', index, Budgets.domContentLoadedIndex);

      await registerPage.goto();
      const register = await readNavTiming(registerPage.page);
      assertNav('register', register, Budgets.domContentLoaded);

      await attachMetrics(testInfo, 'public-pages', { index, register });
    },
  );

  test(
    'account pages become ready within budget',
    { tag: '@perf' },
    async (
      { sharedUser: user, overviewPage, openAccountPage, transferPage, findTransactionsPage },
      testInfo,
    ) => {
      expect(user.customerId).toBeGreaterThan(0);
      const pages: [string, BasePage][] = [
        ['overview', overviewPage],
        ['openaccount', openAccountPage],
        ['transfer', transferPage],
        ['findtrans', findTransactionsPage],
      ];
      const metrics: Record<string, NavTiming & { ready: number }> = {};
      for (const [name, po] of pages) {
        // goto() includes waitUntilReady(): the AJAX table/dropdown is populated.
        const ready = await timed(() => po.goto());
        const nav = await readNavTiming(po.page);
        assertNav(name, nav, Budgets.domContentLoaded);
        expect.soft(ready, `${name} ready (AJAX populated)`).toBeLessThan(Budgets.dropdownReady);
        metrics[name] = { ...nav, ready };
      }
      await attachMetrics(testInfo, 'account-pages', metrics);
    },
  );

  test(
    'key actions respond within budget',
    { tag: '@perf' },
    async ({ homePage, overviewPage, transferPage, registeredUser, api }, testInfo) => {
      await homePage.goto();
      const login = await timed(async () => {
        await homePage.loginPanel.login(registeredUser.username, registeredUser.password);
        await overviewPage.waitUntilReady();
      });
      expect.soft(login, 'login -> overview').toBeLessThan(Budgets.login);

      // Network time only: api.lastDurationMs excludes pacing / ban waits inside the client.
      await api.getAccounts(registeredUser.customerId);
      const accountsGet = api.lastDurationMs;
      expect.soft(accountsGet, 'REST GET accounts').toBeLessThan(Budgets.restAccounts);

      await transferPage.goto();
      const transfer = await timed(() =>
        transferPage.transfer(
          '1',
          registeredUser.primaryAccountId,
          registeredUser.primaryAccountId,
        ),
      );
      expect.soft(transfer, 'transfer submit -> result').toBeLessThan(Budgets.action);
      await expect(transferPage.result).toBeVisible();

      await attachMetrics(testInfo, 'actions', { login, accountsGet, transfer });
    },
  );
});
