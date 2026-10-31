import { expect, test, type AccountsHelper } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import { distinctiveCents } from '@src/data/factories';
import { addUtcDays, formatApiDate } from '@src/utils/dates';
import { centsToDecimal, formatMoney } from '@src/utils/money';
import type { ParaBankApiClient } from '@src/api/ParaBankApiClient';
import type { Transaction } from '@src/api/types';
import { hits } from '@src/pages';

interface Seeded {
  accountId: number;
  cents: number;
  tx: Transaction;
  /** The server's transaction date (midnight UTC), formatted MM-dd-yyyy. */
  date: string;
}

/** Arrange: a fresh SAVINGS account with one distinctive credit, via API. */
async function seedCredit(accounts: AccountsHelper, api: ParaBankApiClient): Promise<Seeded> {
  return test.step('[api] seed a distinctive credit', async () => {
    const savings = await accounts.open('SAVINGS');
    const cents = distinctiveCents();
    await accounts.transfer(accounts.primaryAccountId, savings.id, cents);
    const credits = (await api.findTransactionsByAmount(savings.id, cents / 100)).filter(
      (t) => t.type === 'Credit',
    );
    expect(credits, 'seeded credit visible via API').toHaveLength(1);
    const tx = credits[0];
    // Use the SERVER's date for the transaction, not the client clock (they can differ near midnight).
    return { accountId: savings.id, cents, tx, date: formatApiDate(tx.date) };
  });
}

test.describe('Find transactions', () => {
  test(
    'finds a transaction by id',
    { tag: ['@smoke', '@regression'] },
    async ({ page, findTransactionsPage, accounts, api }) => {
      const s = await seedCredit(accounts, api);
      const searches: string[] = [];
      page.on('request', (r) => hits('transactions', r.url()) && searches.push(r.url()));

      await findTransactionsPage.goto();
      await findTransactionsPage.findById(s.tx.id);
      // Positive control for the "no search request" check in the validation test.
      expect(searches, 'transactions endpoint predicate matches the real search').toHaveLength(1);

      await expect(
        findTransactionsPage.heading(Messages.findTransactions.resultsHeading),
      ).toBeVisible();
      await expect(findTransactionsPage.rows).toHaveCount(1);
      expect(await findTransactionsPage.rowTransactionIds()).toEqual([s.tx.id]);
      await expect(findTransactionsPage.rows.first()).toContainText(formatMoney(s.cents));
      await expect(findTransactionsPage.rows.first()).toContainText(s.date);
    },
  );

  test(
    'finds transactions by date',
    { tag: '@regression' },
    async ({ findTransactionsPage, accounts, api }) => {
      const s = await seedCredit(accounts, api);

      await findTransactionsPage.goto();
      await findTransactionsPage.findByDate(s.accountId, s.date);

      expect(await findTransactionsPage.rowTransactionIds()).toContain(s.tx.id);
      const apiIds = (await api.findTransactionsOnDate(s.accountId, new Date(s.tx.date))).map(
        (t) => t.id,
      );
      expect((await findTransactionsPage.rowTransactionIds()).sort()).toEqual(apiIds.sort());
    },
  );

  test(
    'finds transactions in a date range',
    { tag: '@regression' },
    async ({ findTransactionsPage, accounts, api }) => {
      const s = await seedCredit(accounts, api);
      const from = formatApiDate(addUtcDays(s.tx.date, -1));
      const to = formatApiDate(addUtcDays(s.tx.date, 1));

      await findTransactionsPage.goto();
      await findTransactionsPage.findByDateRange(s.accountId, from, to);

      const uiIds = await findTransactionsPage.rowTransactionIds();
      expect(uiIds).toContain(s.tx.id);
      const apiIds = (
        await api.findTransactionsInRange(
          s.accountId,
          addUtcDays(s.tx.date, -1),
          addUtcDays(s.tx.date, 1),
        )
      ).map((t) => t.id);
      expect([...uiIds].sort()).toEqual([...apiIds].sort());
    },
  );

  test(
    'finds transactions by amount',
    { tag: '@regression' },
    async ({ findTransactionsPage, accounts, api }) => {
      const s = await seedCredit(accounts, api);

      await findTransactionsPage.goto();
      await findTransactionsPage.findByAmount(s.accountId, centsToDecimal(s.cents));

      expect(await findTransactionsPage.rowTransactionIds()).toEqual([s.tx.id]);
      await expect(findTransactionsPage.rows.first()).toContainText(formatMoney(s.cents));
    },
  );

  test(
    'returns an empty result for a date with no activity',
    { tag: '@regression' },
    async ({ findTransactionsPage, sharedUser }) => {
      await findTransactionsPage.goto();
      await findTransactionsPage.findByDate(sharedUser.primaryAccountId, '01-01-2000');

      await expect(findTransactionsPage.results).toBeVisible();
      await expect(findTransactionsPage.rows).toHaveCount(0);
    },
  );

  test(
    'shows an empty result for a transaction id that does not exist',
    { tag: '@regression' },
    async ({ page, findTransactionsPage, sharedUser }) => {
      // Documented quirk (ui-map 2.8): the XHR answers 404 and the page shows 0 rows, no message.
      expect(sharedUser.customerId).toBeGreaterThan(0);
      const statuses: number[] = [];
      page.on('response', (r) => hits('transactions', r.url()) && statuses.push(r.status()));

      await findTransactionsPage.goto();
      await findTransactionsPage.findById(999_999_999);

      await expect(
        findTransactionsPage.heading(Messages.findTransactions.resultsHeading),
      ).toBeVisible();
      await expect(findTransactionsPage.rows).toHaveCount(0);
      await expect(findTransactionsPage.error).toBeHidden();
      expect(statuses).toEqual([404]);
    },
  );

  test(
    'validates input formats on the client',
    { tag: '@regression' },
    async ({ page, findTransactionsPage, sharedUser: user }) => {
      const searches: string[] = [];
      page.on('request', (r) => hits('transactions', r.url()) && searches.push(r.url()));
      await findTransactionsPage.goto();

      await test.step('non-numeric transaction id', async () => {
        await findTransactionsPage.findById('abc', false);
        await expect(findTransactionsPage.errors.id).toHaveText(
          Messages.findTransactions.invalidId,
        );
      });

      await test.step('ISO date instead of MM-DD-YYYY', async () => {
        await findTransactionsPage.findByDate(user.primaryAccountId, '2026-10-31', false);
        await expect(findTransactionsPage.errors.date).toHaveText(
          Messages.findTransactions.invalidDate,
        );
      });

      await test.step('slash-separated date range', async () => {
        await findTransactionsPage.findByDateRange(
          user.primaryAccountId,
          '10/01/2026',
          '12-31-2026',
          false,
        );
        await expect(findTransactionsPage.errors.range).toHaveText(
          Messages.findTransactions.invalidDate,
        );
      });

      await test.step('non-numeric amount', async () => {
        await findTransactionsPage.findByAmount(user.primaryAccountId, 'x1', false);
        await expect(findTransactionsPage.errors.amount).toHaveText(
          Messages.findTransactions.invalidAmount,
        );
      });

      await expect(findTransactionsPage.form).toBeVisible();
      expect(searches, 'no search request for invalid input').toEqual([]);
    },
  );
});
