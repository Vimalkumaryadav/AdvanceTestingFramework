import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import { distinctiveCents } from '@src/data/factories';
import { centsToDecimal, formatMoney } from '@src/utils/money';

test.describe('Transfer funds', () => {
  test(
    'moves money between own accounts and the API balances agree',
    { tag: ['@smoke', '@regression'] },
    async ({ transferPage, accounts, api, user }) => {
      const savings = await accounts.open('SAVINGS');
      const cents = distinctiveCents();
      const fromBefore = await accounts.balanceCents(user.primaryAccountId);
      const toBefore = await accounts.balanceCents(savings.id);

      await transferPage.goto();
      const response = await transferPage.transfer(
        centsToDecimal(cents),
        user.primaryAccountId,
        savings.id,
      );
      expect(response.status()).toBe(200);

      await test.step('confirmation names amount and both accounts', async () => {
        await expect(transferPage.heading(Messages.transfer.heading)).toBeVisible();
        await expect(transferPage.result).toContainText(
          Messages.transfer.success(formatMoney(cents), user.primaryAccountId, savings.id),
        );
      });

      await test.step('API: source debited and target credited by exactly the amount', async () => {
        expect(await accounts.balanceCents(user.primaryAccountId)).toBe(fromBefore - cents);
        expect(await accounts.balanceCents(savings.id)).toBe(toBefore + cents);
        const credits = await api.findTransactionsByAmount(savings.id, cents / 100);
        expect(credits.map((t) => [t.type, t.description])).toContainEqual([
          'Credit',
          'Funds Transfer Received',
        ]);
      });
    },
  );

  for (const amount of ['', 'abc']) {
    test(
      `rejects a ${amount ? 'non-numeric' : 'missing'} amount without moving money`,
      { tag: '@regression' },
      async ({ transferPage, accounts, user }) => {
        const savings = await accounts.open('SAVINGS');
        const fromBefore = await accounts.balanceCents(user.primaryAccountId);

        await transferPage.goto();
        const response = await transferPage.transfer(amount, user.primaryAccountId, savings.id);

        // No client-side validation exists: the server answers 400 and the page shows its generic error.
        expect(response.status()).toBe(400);
        await expect(transferPage.error).toContainText(Messages.generic.internalError);
        await expect(transferPage.result).toBeHidden();
        expect(await accounts.balanceCents(user.primaryAccountId)).toBe(fromBefore);
      },
    );
  }
});
