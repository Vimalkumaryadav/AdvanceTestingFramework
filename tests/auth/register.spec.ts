import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';

test.describe('Registration', () => {
  test(
    'a new customer can register and is logged in automatically',
    { tag: ['@smoke', '@regression'] },
    async ({ page, registerPage, newUser, api }) => {
      await registerPage.goto();
      await registerPage.register(newUser);

      await test.step('UI shows the welcome state and the account menu', async () => {
        await expect(page).toHaveTitle(Messages.register.successTitle);
        await expect(
          registerPage.heading(Messages.register.welcomeHeading(newUser.username)),
        ).toBeVisible();
        await expect(registerPage.content).toContainText(Messages.register.success);
        await expect(registerPage.welcome).toHaveText(
          `Welcome ${newUser.firstName} ${newUser.lastName}`,
        );
        await expect(registerPage.menu.link('Log Out')).toBeVisible();
      });

      await test.step('API: customer exists with exactly one CHECKING account', async () => {
        const customer = await api.login(newUser.username, newUser.password);
        expect(customer).toMatchObject({
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          ssn: newUser.ssn,
          address: newUser.address,
        });
        const accounts = await api.getAccounts(customer.id);
        expect(accounts).toHaveLength(1);
        expect(accounts[0].type).toBe('CHECKING');
      });
    },
  );

  test(
    'rejects a username that already exists',
    { tag: '@regression' },
    async ({ registerPage, registeredUser, newUser }) => {
      await registerPage.goto();
      await registerPage.register(newUser, { 'customer.username': registeredUser.username });

      await expect(registerPage.fieldError('customer.username')).toHaveText(
        Messages.register.duplicateUsername,
      );
      await expect(registerPage.welcome).toBeHidden();
    },
  );

  test(
    'shows a required-field error for every mandatory field',
    { tag: '@regression' },
    async ({ registerPage }) => {
      await registerPage.goto();
      await registerPage.submit.click();

      const required = Messages.register.required;
      for (const [field, message] of Object.entries(required)) {
        await expect.soft(registerPage.fieldError(field), field).toHaveText(message);
      }

      await test.step('phone number is optional', async () => {
        await expect(registerPage.fieldError('customer.phoneNumber')).toHaveCount(0);
      });

      await expect(registerPage.allFieldErrors).toHaveCount(Object.keys(required).length);
    },
  );

  test(
    'rejects mismatched password confirmation',
    { tag: '@regression' },
    async ({ registerPage, newUser }) => {
      await registerPage.goto();
      await registerPage.register(newUser, { repeatedPassword: `${newUser.password}x` });

      await expect(registerPage.fieldError('repeatedPassword')).toHaveText(
        Messages.register.passwordMismatch,
      );
      await expect(registerPage.allFieldErrors).toHaveCount(1);
    },
  );
});
