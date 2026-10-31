import { expect, test, type Locator } from '@playwright/test';
import type { NewAccountTypeName } from '../../api/types';
import { BasePage } from '../BasePage';
import { hits } from '../endpoints';

/**
 * openaccount.htm. #fromAccountId is filled by XHR; clicking before that throws a JS error
 * in the page (accounts is null), so waitUntilReady() waits for options.
 */
export class OpenAccountPage extends BasePage {
  protected readonly path = 'openaccount.htm';

  readonly type: Locator = this.page.locator('#type');
  readonly fromAccount: Locator = this.page.locator('#fromAccountId');
  readonly submit: Locator = this.page
    .locator('#openAccountForm')
    .getByRole('button', { name: 'Open New Account' });
  readonly result: Locator = this.page.locator('#openAccountResult');
  readonly newAccountId: Locator = this.page.locator('#newAccountId');
  readonly error: Locator = this.page.locator('#openAccountError');

  override async waitUntilReady(): Promise<void> {
    await this.waitForOptions(this.fromAccount);
  }

  /** Opens an account and returns the new id shown in #newAccountId. */
  async open(type: NewAccountTypeName, fromAccountId: number): Promise<number> {
    return test.step(`open ${type} account funded from #${fromAccountId}`, async () => {
      await this.waitUntilReady();
      await this.type.selectOption({ label: type });
      await this.fromAccount.selectOption(String(fromAccountId));
      const created = this.page.waitForResponse(
        (r) => hits('createAccount', r.url()) && r.request().method() === 'POST',
      );
      await this.submit.click();
      expect((await created).ok(), 'createAccount XHR should succeed').toBe(true);
      await expect(this.newAccountId).toHaveText(/^\d+$/);
      return Number(await this.newAccountId.innerText());
    });
  }
}
