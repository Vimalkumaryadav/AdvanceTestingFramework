import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import { buildAddress } from '@src/data/factories';
import { faker } from '@faker-js/faker';
import { hits } from '@src/pages';

test.describe('Update contact info', () => {
  test(
    'updates address and phone, persisted server-side',
    { tag: ['@smoke', '@regression'] },
    async ({ page, updateProfilePage, user, api }) => {
      const address = buildAddress();
      const phone = faker.string.numeric({ length: 10, allowLeadingZeros: false });

      await updateProfilePage.goto();

      await test.step('form is pre-filled with the current profile', async () => {
        expect(await updateProfilePage.readValues()).toEqual({
          firstName: user.firstName,
          lastName: user.lastName,
          address: user.address,
          phoneNumber: user.phoneNumber,
        });
      });

      // Positive control: the same predicate the negative test uses must match a real update.
      const saved = page.waitForResponse((r) => hits('profileUpdate', r.url()));
      await updateProfilePage.update({
        'customer.address.street': address.street,
        'customer.address.city': address.city,
        'customer.address.state': address.state,
        'customer.address.zipCode': address.zipCode,
        'customer.phoneNumber': phone,
      });
      expect((await saved).status()).toBe(200);
      await expect(updateProfilePage.heading(Messages.updateProfile.heading)).toBeVisible();
      await expect(updateProfilePage.result).toContainText(Messages.updateProfile.success);

      await test.step('API returns the new contact details', async () => {
        const customer = await api.getCustomer(user.customerId);
        expect(customer.address).toEqual(address);
        expect(customer.phoneNumber).toBe(phone);
        expect(customer.firstName).toBe(user.firstName);
      });

      await test.step('reloaded form shows the new values', async () => {
        await updateProfilePage.goto();
        const values = await updateProfilePage.readValues();
        expect(values.address).toEqual(address);
        expect(values.phoneNumber).toBe(phone);
      });

      await test.step('credentials still work after the update', async () => {
        await expect(api.login(user.username, user.password)).resolves.toMatchObject({
          id: user.customerId,
        });
      });
    },
  );

  test(
    'requires name and address fields',
    { tag: '@regression' },
    async ({ page, updateProfilePage, sharedUser: user, api }) => {
      // The shared worker user is never modified by the success test (that one owns its user).
      const updates: string[] = [];
      page.on('request', (r) => hits('profileUpdate', r.url()) && updates.push(r.url()));

      await updateProfilePage.goto();
      await updateProfilePage.update({
        'customer.firstName': '',
        'customer.lastName': '',
        'customer.address.street': '',
        'customer.address.city': '',
        'customer.address.state': '',
        'customer.address.zipCode': '',
      });

      for (const [key, message] of Object.entries(Messages.updateProfile.required)) {
        await expect
          .soft(
            updateProfilePage.fieldError(key as keyof typeof Messages.updateProfile.required),
            key,
          )
          .toHaveText(message);
        await expect
          .soft(
            updateProfilePage.fieldError(key as keyof typeof Messages.updateProfile.required),
            key,
          )
          .toBeVisible();
      }
      await expect(updateProfilePage.result).toBeHidden();
      expect(updates, 'no update request for an invalid form').toEqual([]);

      await test.step('API: stored profile is untouched', async () => {
        const customer = await api.getCustomer(user.customerId);
        expect(customer).toMatchObject({
          firstName: user.firstName,
          lastName: user.lastName,
          address: user.address,
        });
      });
    },
  );
});
