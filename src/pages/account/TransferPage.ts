import { test, type Locator, type Response } from '@playwright/test';
import { BasePage } from '../BasePage';
import { hits } from '../endpoints';

/**
 * transfer.htm. Both selects are filled by XHR. There is NO client-side validation: the
 * `p#amount.errors` paragraphs exist but are never shown; bad input yields the generic
 * #showError view after a 400.
 */
export class TransferPage extends BasePage {
  protected readonly path = 'transfer.htm';

  readonly amount: Locator = this.page.locator('#amount');
  readonly fromAccount: Locator = this.page.locator('#fromAccountId');
  readonly toAccount: Locator = this.page.locator('#toAccountId');
  readonly submit: Locator = this.page
    .locator('#transferForm')
    .getByRole('button', { name: 'Transfer' });
  readonly result: Locator = this.page.locator('#showResult');
  readonly amountResult: Locator = this.page.locator('#amountResult');
  readonly fromAccountResult: Locator = this.page.locator('#fromAccountIdResult');
  readonly toAccountResult: Locator = this.page.locator('#toAccountIdResult');
  readonly error: Locator = this.page.locator('#showError');

  override async waitUntilReady(): Promise<void> {
    await this.waitForOptions(this.fromAccount);
    await this.waitForOptions(this.toAccount);
  }

  /** Submits a transfer; resolves with the transfer XHR response. */
  async transfer(amount: string, fromAccountId: number, toAccountId: number): Promise<Response> {
    return test.step(`transfer "${amount}" from #${fromAccountId} to #${toAccountId}`, async () => {
      await this.waitUntilReady();
      await this.amount.fill(amount);
      await this.fromAccount.selectOption(String(fromAccountId));
      await this.toAccount.selectOption(String(toAccountId));
      const done = this.page.waitForResponse((r) => hits('transfer', r.url()));
      await this.submit.click();
      const response = await done;
      await this.waitForOutcome(this.result, this.error);
      return response;
    });
  }
}
