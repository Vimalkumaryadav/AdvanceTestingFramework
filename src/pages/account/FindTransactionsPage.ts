import { test, type Locator } from '@playwright/test';
import { BasePage } from '../BasePage';
import { hits } from '../endpoints';

export type FindBy = 'id' | 'date' | 'range' | 'amount';

/**
 * findtrans.htm. The account select is server-rendered. Each search replaces the form with
 * #resultContainer; reload the page to search again. Error spans (#transactionIdError, ...)
 * are always "visible" empty inline spans, so assert on their TEXT, not visibility.
 * Find-by-ID ignores the selected account.
 */
export class FindTransactionsPage extends BasePage {
  protected readonly path = 'findtrans.htm';

  readonly account: Locator = this.page.locator('#accountId');
  readonly transactionId: Locator = this.page.locator('#transactionId');
  readonly transactionDate: Locator = this.page.locator('#transactionDate');
  readonly fromDate: Locator = this.page.locator('#fromDate');
  readonly toDate: Locator = this.page.locator('#toDate');
  readonly amount: Locator = this.page.locator('#amount');
  readonly buttons: Record<FindBy, Locator> = {
    id: this.page.locator('#findById'),
    date: this.page.locator('#findByDate'),
    range: this.page.locator('#findByDateRange'),
    amount: this.page.locator('#findByAmount'),
  };
  readonly errors = {
    id: this.page.locator('#transactionIdError'),
    date: this.page.locator('#transactionDateError'),
    range: this.page.locator('#dateRangeError'),
    amount: this.page.locator('#amountError'),
  } satisfies Record<FindBy, Locator>;
  readonly form: Locator = this.page.locator('#formContainer');
  readonly results: Locator = this.page.locator('#resultContainer');
  readonly rows: Locator = this.page.locator('#transactionBody tr');
  readonly error: Locator = this.page.locator('#errorContainer');

  override async waitUntilReady(): Promise<void> {
    await this.waitForOptions(this.account);
  }

  private async submit(by: FindBy, expectRequest: boolean): Promise<void> {
    if (!expectRequest) {
      await this.buttons[by].click();
      return;
    }
    const done = this.page.waitForResponse((r) => hits('transactions', r.url()));
    await this.buttons[by].click();
    await done;
    await this.waitForOutcome(this.results, this.error);
  }

  async findById(id: number | string, expectRequest = true): Promise<void> {
    await test.step(`find transaction by id ${id}`, async () => {
      await this.transactionId.fill(String(id));
      await this.submit('id', expectRequest);
    });
  }

  async findByDate(accountId: number, date: string, expectRequest = true): Promise<void> {
    await test.step(`find transactions on ${date} for #${accountId}`, async () => {
      await this.account.selectOption(String(accountId));
      await this.transactionDate.fill(date);
      await this.submit('date', expectRequest);
    });
  }

  async findByDateRange(
    accountId: number,
    from: string,
    to: string,
    expectRequest = true,
  ): Promise<void> {
    await test.step(`find transactions ${from}..${to} for #${accountId}`, async () => {
      await this.account.selectOption(String(accountId));
      await this.fromDate.fill(from);
      await this.toDate.fill(to);
      await this.submit('range', expectRequest);
    });
  }

  async findByAmount(accountId: number, amount: string, expectRequest = true): Promise<void> {
    await test.step(`find transactions of ${amount} for #${accountId}`, async () => {
      await this.account.selectOption(String(accountId));
      await this.amount.fill(amount);
      await this.submit('amount', expectRequest);
    });
  }

  /** Row link -> href "/parabank/transaction.htm?id={id}". */
  async rowTransactionIds(): Promise<number[]> {
    const hrefs = await this.rows
      .locator('a')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    return hrefs.map((h) => Number(new URL(h, 'http://x').searchParams.get('id')));
  }
}
