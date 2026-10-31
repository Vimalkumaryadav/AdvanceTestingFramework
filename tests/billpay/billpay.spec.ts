import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import { buildPayee, distinctiveCents } from '@src/data/factories';
import { centsToDecimal, formatMoney } from '@src/utils/money';
import { hits, type BillPayErrorKey, type BillPayForm } from '@src/pages';
import type { Payee } from '@src/api/types';

function formFor(payee: Payee, amount: string, fromAccountId: number): BillPayForm {
  return {
    payeeName: payee.name,
    street: payee.address.street,
    city: payee.address.city,
    state: payee.address.state,
    zipCode: payee.address.zipCode,
    phone: payee.phoneNumber,
    accountNumber: String(payee.accountNumber),
    verifyAccount: String(payee.accountNumber),
    amount,
    fromAccountId,
  };
}

test.describe('Bill pay', () => {
  test(
    'pays a payee and debits the chosen account (API cross-check)',
    { tag: ['@smoke', '@regression'] },
    async ({ page, billPayPage, accounts, api, user }) => {
      const payee = buildPayee();
      const cents = distinctiveCents();
      const before = await accounts.balanceCents(user.primaryAccountId);
      const calls: string[] = [];
      page.on('request', (r) => hits('billpay', r.url()) && calls.push(r.url()));

      await billPayPage.goto();
      const response = await billPayPage.pay(
        formFor(payee, centsToDecimal(cents), user.primaryAccountId),
      );
      expect(response.status()).toBe(200);
      // Positive control for the "no billpay request" checks below: the predicate does match.
      expect(calls, 'billpay endpoint predicate matches the real request').toHaveLength(1);

      await test.step('confirmation names payee, amount and account', async () => {
        await expect(billPayPage.heading(Messages.billPay.heading)).toBeVisible();
        await expect(page).toHaveTitle('ParaBank | Bill Payment Complete');
        await expect(billPayPage.result).toContainText(
          Messages.billPay.success(payee.name, formatMoney(cents), user.primaryAccountId),
        );
      });

      await test.step('API: account debited by exactly the amount', async () => {
        expect(await accounts.balanceCents(user.primaryAccountId)).toBe(before - cents);
        const debits = await api.findTransactionsByAmount(user.primaryAccountId, cents / 100);
        expect(debits.map((t) => t.type)).toContain('Debit');
      });
    },
  );

  test(
    'flags every required field when submitted empty, without calling the server',
    { tag: '@regression' },
    async ({ page, billPayPage, sharedUser }) => {
      const calls: string[] = [];
      page.on('request', (r) => hits('billpay', r.url()) && calls.push(r.url()));

      await billPayPage.goto();
      await billPayPage.submitExpectingValidation({ fromAccountId: sharedUser.primaryAccountId });

      const expected: [BillPayErrorKey, string][] = [
        ['name', Messages.billPay.errors.name],
        ['address', Messages.billPay.errors.address],
        ['city', Messages.billPay.errors.city],
        ['state', Messages.billPay.errors.state],
        ['zipCode', Messages.billPay.errors.zipCode],
        ['phoneNumber', Messages.billPay.errors.phoneNumber],
        ['account-empty', Messages.billPay.errors.accountEmpty],
        ['verifyAccount-empty', Messages.billPay.errors.verifyAccountEmpty],
        ['amount-empty', Messages.billPay.errors.amountEmpty],
      ];
      for (const [key, message] of expected) {
        await expect.soft(billPayPage.validation(key), key).toBeVisible();
        await expect.soft(billPayPage.validation(key), key).toHaveText(message);
      }
      await expect(billPayPage.visibleValidation).toHaveCount(expected.length);
      expect(calls, 'no billpay request for an invalid form').toEqual([]);
    },
  );

  const invalid: { name: string; patch: Partial<BillPayForm>; errors: BillPayErrorKey[] }[] = [
    {
      name: 'mismatched account numbers',
      patch: { verifyAccount: '54321', accountNumber: '12345' },
      errors: ['verifyAccount-mismatch'],
    },
    {
      name: 'non-numeric account numbers',
      patch: { accountNumber: 'abc', verifyAccount: 'abc' },
      errors: ['account-invalid', 'verifyAccount-invalid'],
    },
    { name: 'a non-numeric amount', patch: { amount: 'ten' }, errors: ['amount-invalid'] },
  ];
  for (const c of invalid) {
    test(`rejects ${c.name}`, { tag: '@regression' }, async ({ billPayPage, sharedUser }) => {
      const valid = formFor(buildPayee(), '12.34', sharedUser.primaryAccountId);

      await billPayPage.goto();
      await billPayPage.submitExpectingValidation({ ...valid, ...c.patch });

      for (const key of c.errors) {
        await expect(billPayPage.validation(key)).toHaveText(
          Messages.billPay.errors[errorMessageKey(key)],
        );
      }
      await expect(billPayPage.visibleValidation).toHaveCount(c.errors.length);
      await expect(billPayPage.result).toBeHidden();
    });
  }
});

function errorMessageKey(key: BillPayErrorKey): keyof typeof Messages.billPay.errors {
  const map: Partial<Record<BillPayErrorKey, keyof typeof Messages.billPay.errors>> = {
    'account-invalid': 'accountInvalid',
    'verifyAccount-invalid': 'verifyAccountInvalid',
    'verifyAccount-mismatch': 'verifyAccountMismatch',
    'amount-invalid': 'amountInvalid',
  };
  const mapped = map[key];
  if (!mapped) throw new Error(`No message mapping for ${key}`);
  return mapped;
}
