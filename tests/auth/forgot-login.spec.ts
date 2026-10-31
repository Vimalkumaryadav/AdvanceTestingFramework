import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import type { LookupField } from '@src/pages';

test.describe('Forgot login info', () => {
  test(
    'recovers credentials for a known customer and logs them in',
    { tag: ['@smoke', '@regression'] },
    async ({ lookupPage, registeredUser }) => {
      await lookupPage.goto();
      await lookupPage.findLogin(registeredUser);

      await expect(lookupPage.content).toContainText(Messages.lookup.success);
      await expect(lookupPage.credentials).toContainText(`Username: ${registeredUser.username}`);
      await expect(lookupPage.credentials).toContainText(`Password: ${registeredUser.password}`);
      await expect(lookupPage.welcome).toHaveText(
        `Welcome ${registeredUser.firstName} ${registeredUser.lastName}`,
      );
    },
  );

  test(
    'reports when no customer matches',
    { tag: '@regression' },
    async ({ page, lookupPage, newUser }) => {
      await lookupPage.goto();
      await lookupPage.findLogin(newUser); // never registered

      await expect(page).toHaveTitle('ParaBank | Error');
      await expect(lookupPage.visibleError).toHaveText(Messages.lookup.notFound);
    },
  );

  test('requires every lookup field', { tag: '@regression' }, async ({ lookupPage }) => {
    await lookupPage.goto();
    await lookupPage.submit.click();

    for (const [field, message] of Object.entries(Messages.lookup.required)) {
      await expect.soft(lookupPage.fieldError(field as LookupField), field).toHaveText(message);
    }
    // Hard count: an extra, unexpected error message must fail the test too.
    await expect(lookupPage.allFieldErrors).toHaveCount(
      Object.keys(Messages.lookup.required).length,
    );
  });
});
