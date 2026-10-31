import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';

test.describe('Login and logout', () => {
  test(
    'a registered customer can log in and log out',
    { tag: ['@smoke', '@regression'] },
    async ({ page, homePage, overviewPage, registeredUser }) => {
      await homePage.goto();
      await homePage.loginPanel.login(registeredUser.username, registeredUser.password);

      await test.step('lands on Accounts Overview, logged in', async () => {
        await expect(page).toHaveURL(/overview\.htm/);
        await overviewPage.waitUntilReady();
        await expect(overviewPage.accountLink(registeredUser.primaryAccountId)).toBeVisible();
        await expect(overviewPage.welcome).toHaveText(
          `Welcome ${registeredUser.firstName} ${registeredUser.lastName}`,
        );
      });

      await test.step('log out returns to the public home page', async () => {
        await overviewPage.menu.logOut();
        await expect(page).toHaveURL(/index\.htm/);
        await expect(homePage.loginPanel.submit).toBeVisible();
        await expect(homePage.menu.link('Log Out')).toBeHidden();
      });
    },
  );

  test(
    'rejects a wrong password',
    { tag: '@regression' },
    async ({ page, homePage, loginErrorPage, registeredUser }) => {
      await homePage.goto();
      await homePage.loginPanel.login(registeredUser.username, `${registeredUser.password}x`);

      await expect(page).toHaveURL(/login\.htm/);
      await expect(page).toHaveTitle('ParaBank | Error');
      await expect(loginErrorPage.visibleError).toHaveText(Messages.login.invalidCredentials);
    },
  );

  const anonymousCases = [
    {
      name: 'an unknown username',
      username: 'nouser_x9q',
      password: 'whatever1',
      message: Messages.login.invalidCredentials,
    },
    {
      name: 'empty credentials',
      username: '',
      password: '',
      message: Messages.login.missingCredentials,
    },
  ];
  for (const c of anonymousCases) {
    test(
      `rejects ${c.name}`,
      { tag: '@regression' },
      async ({ page, homePage, loginErrorPage }) => {
        await homePage.goto();
        await homePage.loginPanel.login(c.username, c.password);

        await expect(page).toHaveURL(/login\.htm/);
        await expect(loginErrorPage.title).toHaveText(Messages.generic.errorHeading);
        await expect(loginErrorPage.visibleError).toHaveText(c.message);
      },
    );
  }

  test(
    'protected pages are not served to anonymous visitors',
    { tag: '@regression' },
    async ({ page, overviewPage }) => {
      // Observed behaviour: no redirect to login; the server renders its generic error page.
      const response = await page.goto('overview.htm');
      expect(response?.status()).toBe(500);
      await expect(page).toHaveTitle('ParaBank | Error');
      await expect(overviewPage.visibleError).toHaveText(Messages.generic.internalError);
    },
  );
});
