import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import { distinctiveCents } from '@src/data/factories';
import { formatApiDate, utcMonthName } from '@src/utils/dates';
import { formatMoney, toCents } from '@src/utils/money';
import type { Month } from '@src/api/types';

test.describe('Accounts overview', () => {
  test(
    'lists every account with balances that match the API',
    { tag: ['@smoke', '@regression'] },
    async ({ overviewPage, accounts, user }) => {
      const savings = await accounts.open('SAVINGS');

      await overviewPage.goto();
      const rows = await overviewPage.readRows();
      const apiAccounts = await accounts.list();

      await test.step('one row per account, balances equal in cents', () => {
        expect(rows.map((r) => r.accountId).sort()).toEqual(apiAccounts.map((a) => a.id).sort());
        for (const account of apiAccounts) {
          const row = rows.find((r) => r.accountId === account.id);
          expect(row?.balanceCents, `balance of #${account.id}`).toBe(toCents(account.balance));
          expect(row?.availableCents, `available of #${account.id}`).toBe(
            Math.max(0, toCents(account.balance)),
          );
        }
        expect(rows.map((r) => r.accountId)).toEqual(
          expect.arrayContaining([user.primaryAccountId, savings.id]),
        );
      });

      await test.step('total equals the sum of balances', async () => {
        const sum = apiAccounts.reduce((acc, a) => acc + toCents(a.balance), 0);
        expect(await overviewPage.totalCents()).toBe(sum);
        await expect(overviewPage.footnote).toHaveText(Messages.overview.footnote);
      });
    },
  );
});

test.describe('Account activity', () => {
  test(
    'shows account details, transactions and filters by month and type',
    { tag: '@regression' },
    async ({ page, overviewPage, activityPage, transactionDetailsPage, accounts, api }) => {
      const savings = await accounts.open('SAVINGS');
      const cents = distinctiveCents();
      await accounts.transfer(accounts.primaryAccountId, savings.id, cents);
      const credit = (await api.findTransactionsByAmount(savings.id, cents / 100)).find(
        (t) => t.type === 'Credit',
      );
      expect(credit, 'seeded credit transaction').toBeDefined();
      const txMonth = utcMonthName(credit!.date) as Month;

      await test.step('navigate from the overview to the account', async () => {
        await overviewPage.goto();
        await overviewPage.openAccount(savings.id);
        await expect(page).toHaveURL(new RegExp(`activity\\.htm\\?id=${savings.id}`));
        await activityPage.waitUntilReady();
      });

      await test.step('details match the API', async () => {
        const fresh = await api.getAccount(savings.id);
        await expect(activityPage.accountId).toHaveText(String(savings.id));
        await expect(activityPage.accountType).toHaveText('SAVINGS');
        await expect(activityPage.balance).toHaveText(formatMoney(toCents(fresh.balance)));
      });

      const row = activityPage.rows.filter({ hasText: formatMoney(cents) });

      await test.step('seeded transfer is listed as a credit', async () => {
        await expect(row).toHaveCount(1);
        await expect(row.locator('td').nth(0)).toHaveText(formatApiDate(credit!.date));
        await expect(row.locator('td').nth(3)).toHaveText(formatMoney(cents));
      });

      await test.step(`filter ${txMonth} + Credit keeps the transaction`, async () => {
        await activityPage.filter(txMonth, 'Credit');
        await expect(row).toHaveCount(1);
      });

      await test.step('filter Debit on a credit-only account shows the empty state', async () => {
        await activityPage.filter(txMonth, 'Debit');
        await expect(activityPage.noTransactions).toHaveText(Messages.activity.noTransactions);
        await expect(activityPage.table).toBeHidden();
      });

      await test.step('transaction details page matches the API', async () => {
        await activityPage.filter('All', 'All');
        await row.getByRole('link').click();
        await expect(page).toHaveURL(new RegExp(`transaction\\.htm\\?id=${credit!.id}`));
        await expect(transactionDetailsPage.value('Transaction ID:')).toHaveText(
          String(credit!.id),
        );
        await expect(transactionDetailsPage.value('Type:')).toHaveText('Credit');
        await expect(transactionDetailsPage.value('Amount:')).toHaveText(formatMoney(cents));
        await expect(transactionDetailsPage.value('Date:')).toHaveText(formatApiDate(credit!.date));
        await expect(transactionDetailsPage.value('Description:')).toHaveText(credit!.description);
        expect(credit!.description).toBe('Funds Transfer Received');
      });
    },
  );
});
