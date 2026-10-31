import { expect, test, type Locator, type Response } from '@playwright/test';
import { BasePage } from '../BasePage';
import { hits } from '../endpoints';

export interface BillPayForm {
  payeeName: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  accountNumber: string;
  verifyAccount: string;
  amount: string;
  fromAccountId: number;
}

export type BillPayErrorKey =
  | 'name'
  | 'address'
  | 'city'
  | 'state'
  | 'zipCode'
  | 'phoneNumber'
  | 'account-empty'
  | 'account-invalid'
  | 'verifyAccount-empty'
  | 'verifyAccount-invalid'
  | 'verifyAccount-mismatch'
  | 'amount-empty'
  | 'amount-invalid';

/**
 * billpay.htm. Inputs have NO stable ids (the phone input's id is a random UUID per load),
 * so everything is located by `name`. The From select is server-rendered in UNSTABLE order:
 * always select explicitly. Validation is client-side (span#validationModel-*).
 */
export class BillPayPage extends BasePage {
  protected readonly path = 'billpay.htm';

  readonly form: Locator = this.page.locator('#billpayForm');
  readonly fromAccount: Locator = this.page.locator('select[name="fromAccountId"]');
  readonly submit: Locator = this.form.getByRole('button', { name: 'Send Payment' });
  readonly result: Locator = this.page.locator('#billpayResult');
  readonly resultPayee: Locator = this.result.locator('#payeeName');
  readonly resultAmount: Locator = this.result.locator('#amount');
  readonly resultFromAccount: Locator = this.result.locator('#fromAccountId');
  readonly error: Locator = this.page.locator('#billpayError');

  input(name: string): Locator {
    return this.form.locator(`[name="${name}"]`);
  }

  validation(key: BillPayErrorKey): Locator {
    return this.form.locator(`#validationModel-${key}`);
  }

  /** All validation spans currently displayed. */
  get visibleValidation(): Locator {
    return this.form.locator('[id^="validationModel-"]').filter({ visible: true });
  }

  override async waitUntilReady(): Promise<void> {
    await this.waitForOptions(this.fromAccount);
  }

  async fill(form: Partial<BillPayForm>): Promise<void> {
    const map: [keyof BillPayForm, string][] = [
      ['payeeName', 'payee.name'],
      ['street', 'payee.address.street'],
      ['city', 'payee.address.city'],
      ['state', 'payee.address.state'],
      ['zipCode', 'payee.address.zipCode'],
      ['phone', 'payee.phoneNumber'],
      ['accountNumber', 'payee.accountNumber'],
      ['verifyAccount', 'verifyAccount'],
      ['amount', 'amount'],
    ];
    for (const [key, name] of map) {
      const value = form[key];
      if (value !== undefined) await this.input(name).fill(String(value));
    }
    if (form.fromAccountId !== undefined) {
      await this.fromAccount.selectOption(String(form.fromAccountId));
    }
  }

  /** Fills and submits a form expected to pass client validation; resolves with the billpay XHR. */
  async pay(form: BillPayForm): Promise<Response> {
    return test.step(`pay ${form.amount} to "${form.payeeName}" from #${form.fromAccountId}`, async () => {
      await this.waitUntilReady();
      await this.fill(form);
      const done = this.page.waitForResponse((r) => hits('billpay', r.url()));
      await this.submit.click();
      const response = await done;
      await this.waitForOutcome(this.result, this.error);
      return response;
    });
  }

  /** Submits without expecting a network call (client-side validation path). */
  async submitExpectingValidation(form: Partial<BillPayForm>): Promise<void> {
    await test.step('submit bill pay with invalid input', async () => {
      await this.waitUntilReady();
      await this.fill(form);
      await this.submit.click();
      await expect(this.visibleValidation.first()).toBeVisible();
    });
  }
}
