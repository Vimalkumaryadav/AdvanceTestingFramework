import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import { toCents } from '@src/utils/money';
import type { NewAccountTypeName } from '@src/api/types';

const cases: { type: NewAccountTypeName; tag: string[] }[] = [
  // @admin-defaults: the opening balance comes from the instance-wide "Min. Balance" setting.
  { type: 'CHECKING', tag: ['@smoke', '@regression', '@admin-defaults'] },
  { type: 'SAVINGS', tag: ['@regression', '@admin-defaults'] },
];

test.describe('Open new account', () => {
  for (const { type, tag } of cases) {
    // eslint-disable-next-line playwright/valid-test-tags -- tags come from the typed table above
    test(
      `opens a ${type} account funded from an existing account`,
      { tag },
      async ({ page, openAccountPage, activityPage, accounts, api, user }) => {
        const sourceBefore = await accounts.balanceCents(user.primaryAccountId);

        await openAccountPage.goto();
        const newId = await openAccountPage.open(type, user.primaryAccountId);

        await test.step('confirmation is shown', async () => {
          await expect(openAccountPage.heading(Messages.openAccount.heading)).toBeVisible();
          await expect(openAccountPage.result).toContainText(Messages.openAccount.success);
          await expect(openAccountPage.newAccountId).toHaveAttribute(
            'href',
            `activity.htm?id=${newId}`,
          );
        });

        await test.step('API: new account belongs to the customer and money moved from the source', async () => {
          const created = await api.getAccount(newId);
          expect(created).toMatchObject({ id: newId, customerId: user.customerId, type });
          const opening = toCents(created.balance);
          expect(opening).toBeGreaterThan(0);
          expect(await accounts.balanceCents(user.primaryAccountId)).toBe(sourceBefore - opening);
        });

        await test.step('new account link opens its activity page', async () => {
          await openAccountPage.newAccountId.click();
          await expect(page).toHaveURL(new RegExp(`activity\\.htm\\?id=${newId}`));
          await expect(activityPage.accountType).toHaveText(type);
        });
      },
    );
  }
});
