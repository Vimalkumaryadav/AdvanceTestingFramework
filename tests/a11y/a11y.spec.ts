import { expect, test } from '@src/fixtures';
import { formatBlocking, scanA11y, type A11yPageKey } from '@src/utils/a11y';
import type { BasePage } from '@src/pages';

/*
 * Gate: fail only on critical/serious violations whose rule id is not allowlisted for the page
 * (src/data/a11y-allowlist.json, from docs/discovery/04). Known defects, stale allowlist entries
 * and node-count drift are attached/annotated, never failing.
 */
test.describe('Accessibility', () => {
  const publicPages: {
    key: A11yPageKey;
    fixture:
      'homePage' | 'registerPage' | 'lookupPage' | 'aboutPage' | 'servicesPage' | 'contactPage';
  }[] = [
    { key: 'index', fixture: 'homePage' },
    { key: 'register', fixture: 'registerPage' },
    { key: 'lookup', fixture: 'lookupPage' },
    { key: 'about', fixture: 'aboutPage' },
    { key: 'services', fixture: 'servicesPage' },
    { key: 'contact', fixture: 'contactPage' },
  ];

  for (const { key, fixture } of publicPages) {
    test(
      `${key}.htm has no new serious/critical violations`,
      { tag: '@a11y' },
      async (
        { homePage, registerPage, lookupPage, aboutPage, servicesPage, contactPage },
        testInfo,
      ) => {
        const po: BasePage = {
          homePage,
          registerPage,
          lookupPage,
          aboutPage,
          servicesPage,
          contactPage,
        }[fixture];
        await po.goto();
        const report = await scanA11y(po.page, key, testInfo);
        expect(report.blocking, formatBlocking(report)).toEqual([]);
      },
    );
  }

  test(
    'authenticated pages have no new serious/critical violations',
    { tag: '@a11y' },
    async (
      {
        sharedUser: user,
        overviewPage,
        openAccountPage,
        transferPage,
        billPayPage,
        findTransactionsPage,
        updateProfilePage,
        requestLoanPage,
      },
      testInfo,
    ) => {
      // The shared worker user (read-only here) keeps the Cloudflare budget low; soft asserts keep
      // per-page results independent.
      const pages: [A11yPageKey, BasePage][] = [
        ['overview', overviewPage],
        ['openaccount', openAccountPage],
        ['transfer', transferPage],
        ['billpay', billPayPage],
        ['findtrans', findTransactionsPage],
        ['updateprofile', updateProfilePage],
        ['requestloan', requestLoanPage],
      ];
      expect(user.customerId).toBeGreaterThan(0);
      for (const [key, po] of pages) {
        await test.step(`scan ${key}.htm`, async () => {
          await po.goto();
          const report = await scanA11y(po.page, key, testInfo);
          expect.soft(report.blocking, `${key}: ${formatBlocking(report)}`).toEqual([]);
        });
      }
    },
  );

  test(
    'keyboard: Tab walks the registration form in visual order',
    { tag: '@a11y' },
    async ({ page, registerPage }) => {
      await registerPage.goto();
      const order = [
        'customer.firstName',
        'customer.lastName',
        'customer.address.street',
        'customer.address.city',
        'customer.address.state',
        'customer.address.zipCode',
        'customer.phoneNumber',
        'customer.ssn',
        'customer.username',
        'customer.password',
        'repeatedPassword',
      ] as const;
      await registerPage.field(order[0]).focus();
      for (const next of order.slice(1)) {
        await page.keyboard.press('Tab');
        await expect(registerPage.field(next)).toBeFocused();
      }
      await page.keyboard.press('Tab');
      await expect(registerPage.submit).toBeFocused();
      const outline = await registerPage.submit.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline, 'focus indicator must not be removed').not.toBe('none');
    },
  );
});
