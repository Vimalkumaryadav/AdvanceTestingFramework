import { test, type Locator, type Response } from '@playwright/test';
import { BasePage } from '../BasePage';
import { hits } from '../endpoints';

/**
 * requestloan.htm. From select is server-rendered. Approval depends on GLOBAL admin settings
 * of the instance (provider/processor/threshold), so keep test amounts far from thresholds.
 */
export class RequestLoanPage extends BasePage {
  protected readonly path = 'requestloan.htm';

  readonly amount: Locator = this.page.locator('#amount');
  readonly downPayment: Locator = this.page.locator('#downPayment');
  readonly fromAccount: Locator = this.page.locator('#fromAccountId');
  readonly submit: Locator = this.page
    .locator('#requestLoanForm')
    .getByRole('button', { name: 'Apply Now' });
  readonly result: Locator = this.page.locator('#requestLoanResult');
  readonly providerName: Locator = this.page.locator('#loanProviderName');
  readonly responseDate: Locator = this.page.locator('#responseDate');
  readonly status: Locator = this.page.locator('#loanStatus');
  readonly approvedBlock: Locator = this.page.locator('#loanRequestApproved');
  readonly deniedMessage: Locator = this.page.locator('#loanRequestDenied p.error');
  readonly newAccountId: Locator = this.page.locator('#newAccountId');
  readonly error: Locator = this.page.locator('#requestLoanError');

  override async waitUntilReady(): Promise<void> {
    await this.waitForOptions(this.fromAccount);
  }

  async apply(amount: string, downPayment: string, fromAccountId: number): Promise<Response> {
    return test.step(`apply for loan ${amount} (down ${downPayment}) from #${fromAccountId}`, async () => {
      await this.waitUntilReady();
      await this.amount.fill(amount);
      await this.downPayment.fill(downPayment);
      await this.fromAccount.selectOption(String(fromAccountId));
      const done = this.page.waitForResponse((r) => hits('requestLoan', r.url()));
      await this.submit.click();
      const response = await done;
      await this.waitForOutcome(this.result, this.error);
      return response;
    });
  }
}
