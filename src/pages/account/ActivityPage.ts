import { expect, test, type Locator } from '@playwright/test';
import type { Month, TransactionType } from '../../api/types';
import { BasePage } from '../BasePage';

/**
 * activity.htm?id={accountId}. Two parallel XHRs fill the details cells and the transaction
 * table. When a filter matches nothing, #transactionTable is HIDDEN and #noTransactions shown.
 */
export class ActivityPage extends BasePage {
  protected readonly path = 'activity.htm';

  readonly accountId: Locator = this.page.locator('#accountId');
  readonly accountType: Locator = this.page.locator('#accountType');
  readonly balance: Locator = this.page.locator('#balance');
  readonly availableBalance: Locator = this.page.locator('#availableBalance');
  readonly month: Locator = this.page.locator('#month');
  readonly transactionType: Locator = this.page.locator('#transactionType');
  readonly go: Locator = this.page.locator('#activityForm').getByRole('button', { name: 'Go' });
  readonly table: Locator = this.page.locator('#transactionTable');
  readonly rows: Locator = this.table.locator('tbody tr');
  readonly noTransactions: Locator = this.page.locator('#noTransactions');
  readonly error: Locator = this.page.locator('#error');

  async gotoAccount(accountId: number): Promise<this> {
    await this.goto(`?id=${accountId}`);
    await expect(this.accountId).toHaveText(String(accountId));
    return this;
  }

  /** Waits for the details XHR to fill the cells (empty at load). */
  override async waitUntilReady(): Promise<void> {
    await expect(this.accountType).toHaveText(/\S/);
  }

  transactionLink(description: string | RegExp): Locator {
    return this.table.getByRole('link', { name: description });
  }

  async filter(month: Month, type: TransactionType | 'All'): Promise<void> {
    await test.step(`filter activity by ${month}/${type}`, async () => {
      await this.month.selectOption(month);
      await this.transactionType.selectOption(type);
      const loaded = this.page.waitForResponse((r) =>
        r.url().includes(`/transactions/month/${month}/type/${type}`),
      );
      await this.go.click();
      await loaded;
    });
  }
}

/** transaction.htm?id={txId}: server-rendered 2-column table, no ids. */
export class TransactionDetailsPage extends BasePage {
  protected readonly path = 'transaction.htm';

  /** Value cell for a row label such as "Transaction ID:" or "Amount:". */
  value(label: 'Transaction ID:' | 'Date:' | 'Description:' | 'Type:' | 'Amount:'): Locator {
    return this.content.locator('tr').filter({ hasText: label }).locator('td').nth(1);
  }
}
