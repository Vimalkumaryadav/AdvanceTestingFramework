import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import { MENU_ITEMS } from '@src/pages';
import type { ContactField } from '@src/pages';

test.describe('Public pages', () => {
  test(
    'info pages render their content',
    { tag: '@regression' },
    async ({ page, aboutPage, servicesPage, siteMapPage }) => {
      await test.step('About Us', async () => {
        await aboutPage.goto();
        await expect(page).toHaveTitle('ParaBank | About Us');
        await expect(aboutPage.heading('ParaSoft Demo Website')).toBeVisible();
        await expect(aboutPage.content).toContainText('ParaBank is not a real bank!');
      });

      await test.step('Services', async () => {
        await servicesPage.goto();
        await expect(page).toHaveTitle('ParaBank | Services');
        await expect(servicesPage.content).toContainText('Available Bookstore SOAP services');
      });

      await test.step('Site Map links every account service', async () => {
        await siteMapPage.goto();
        for (const item of MENU_ITEMS) {
          await expect
            .soft(siteMapPage.content.getByRole('link', { name: item, exact: true }))
            .toBeVisible();
        }
        const menuLinks = siteMapPage.content
          .getByRole('link')
          .filter({ hasText: new RegExp(`^(${MENU_ITEMS.join('|')})$`) });
        await expect(menuLinks).toHaveCount(MENU_ITEMS.length);
      });
    },
  );

  test('Products and Locations point off-site', { tag: '@regression' }, async ({ homePage }) => {
    // Assert the hrefs only: following them loads heavy third-party pages outside our control.
    await homePage.goto();
    await expect(homePage.header.products).toHaveAttribute('href', /parasoft\.com\/.*products/);
    await expect(homePage.header.locations).toHaveAttribute('href', /parasoft\.com\/.*contacts/);
    await expect(homePage.header.aboutUs).toHaveAttribute('href', /^about\.htm/);
  });

  test(
    'admin page exposes application settings (read-only check)',
    { tag: '@regression' },
    async ({ adminPage }) => {
      // NEVER submit this page on a shared instance: settings are global.
      await adminPage.goto();
      await expect(adminPage.heading('Administration')).toBeVisible();
      await expect(adminPage.initialBalance).toHaveValue(/^\d+(\.\d+)?$/);
      await expect(adminPage.minimumBalance).toHaveValue(/^\d+(\.\d+)?$/);
      await expect(adminPage.accessMode).toHaveCount(4);
      await expect(adminPage.loanProvider.locator('option')).toHaveText([
        'JMS',
        'Web Service',
        'Local',
      ]);
    },
  );

  test(
    'customer care accepts a complete message',
    { tag: ['@smoke', '@regression', '@shared-db'] },
    async ({ contactPage }) => {
      const name = 'Ada Lovelace';
      await contactPage.goto();
      await contactPage.send({
        name,
        email: 'ada@example.test',
        phone: '5125550100',
        message: 'Discovery smoke test',
      });

      await expect(contactPage.content).toContainText(Messages.contact.thanks(name));
      await expect(contactPage.content).toContainText(Messages.contact.followUp);
    },
  );

  test('customer care requires every field', { tag: '@regression' }, async ({ contactPage }) => {
    await contactPage.goto();
    await contactPage.submit.click();

    for (const [field, message] of Object.entries(Messages.contact.required)) {
      await expect.soft(contactPage.fieldError(field as ContactField), field).toHaveText(message);
    }
    await expect(contactPage.allFieldErrors).toHaveCount(
      Object.keys(Messages.contact.required).length,
    );
  });
});
