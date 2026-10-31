import { expect, test } from '@src/fixtures';
import { Messages } from '@src/data/messages';
import { formatLoanDate } from '@src/utils/dates';
import type { LoanResponse } from '@src/api/types';

/*
 * Loan decisions depend on GLOBAL admin settings of the instance (provider, processor,
 * threshold; observed: ws / funds / 20%). Amounts are chosen far from any threshold so the
 * outcome is the same under every processor mode we know of.
 */
test.describe('Request loan', () => {
  test(
    'approves a small loan for a well-funded account and opens a loan account',
    { tag: ['@smoke', '@regression', '@admin-defaults'] },
    async ({ page, requestLoanPage, accounts, api, user }) => {
      await accounts.deposit(user.primaryAccountId, 1_000_000); // $10,000.00

      await requestLoanPage.goto();
      const response = await requestLoanPage.apply('500', '200', user.primaryAccountId);
      const body = (await response.json()) as LoanResponse;

      await expect(requestLoanPage.heading(Messages.loan.heading)).toBeVisible();
      await expect(requestLoanPage.status).toHaveText(Messages.loan.status.approved);
      await expect(requestLoanPage.approvedBlock).toContainText(Messages.loan.approved);
      await expect(requestLoanPage.providerName).toHaveText(body.loanProviderName);
      await expect(requestLoanPage.responseDate).toHaveText(formatLoanDate(body.responseDate));
      await expect(requestLoanPage.newAccountId).toHaveText(/^\d+$/);

      await test.step('API: a LOAN account was created for the customer', async () => {
        const loanId = Number(await requestLoanPage.newAccountId.innerText());
        expect(body.accountId).toBe(loanId);
        await expect(api.getAccount(loanId)).resolves.toMatchObject({
          customerId: user.customerId,
          type: 'LOAN',
        });
      });

      await test.step('loan account link opens its activity page', async () => {
        await requestLoanPage.newAccountId.click();
        await expect(page).toHaveURL(/activity\.htm\?id=\d+/);
      });
    },
  );

  const denied = [
    {
      name: 'a down payment larger than the available balance',
      amount: '1000',
      downPayment: '100000',
      message: Messages.loan.denied.insufficientFundsForDownPayment,
    },
    {
      name: 'a loan far beyond the available funds',
      amount: '100000000',
      downPayment: '10',
      message: Messages.loan.denied.insufficientFunds,
    },
  ];
  for (const c of denied) {
    test(
      `denies ${c.name}`,
      { tag: ['@regression', '@admin-defaults'] },
      async ({ requestLoanPage, api, sharedUser: user }) => {
        // Denials open no account and move no money, so the shared worker user is safe here.
        const before = await api.getAccounts(user.customerId);

        await requestLoanPage.goto();
        const response = await requestLoanPage.apply(
          c.amount,
          c.downPayment,
          user.primaryAccountId,
        );
        expect(response.status(), 'declined loans are HTTP 200').toBe(200);

        await expect(requestLoanPage.status).toHaveText(Messages.loan.status.denied);
        await expect(requestLoanPage.deniedMessage).toHaveText(c.message);
        await expect(requestLoanPage.approvedBlock).toBeHidden();
        expect(await api.getAccounts(user.customerId), 'no new account is opened').toHaveLength(
          before.length,
        );
      },
    );
  }

  const invalid = [
    { name: 'empty fields', amount: '', downPayment: '' },
    { name: 'a non-numeric amount', amount: 'abc', downPayment: '10' },
  ];
  for (const c of invalid) {
    test(
      `shows the generic error for ${c.name}`,
      { tag: '@regression' },
      async ({ requestLoanPage, api, sharedUser: user }) => {
        // No client-side validation: the server answers 400 and the page shows its error view.
        const before = await api.getAccounts(user.customerId);

        await requestLoanPage.goto();
        const response = await requestLoanPage.apply(
          c.amount,
          c.downPayment,
          user.primaryAccountId,
        );

        expect(response.status()).toBe(400);
        await expect(requestLoanPage.error).toContainText(Messages.generic.internalError);
        await expect(requestLoanPage.result).toBeHidden();
        expect(await api.getAccounts(user.customerId)).toHaveLength(before.length);
      },
    );
  }
});
