import { expect, type Locator } from '@playwright/test';
import { parseMoney } from '../../utils/money';
import { BasePage } from '../BasePage';

export interface OverviewRow {
  accountId: number;
  balanceCents: number;
  availableCents: number;
}

/** overview.htm. #accountTable tbody is empty at load and filled by an accounts XHR. */
export class OverviewPage extends BasePage {
  protected readonly path = 'overview.htm';

  readonly table: Locator = this.page.locator('#accountTable');
  /** Account rows only (the Total row has no link). */
  readonly accountRows: Locator = this.table
    .locator('tbody tr')
    .filter({ has: this.page.getByRole('link') });
  readonly totalRow: Locator = this.table.locator('tbody tr').filter({ hasText: 'Total' });
  readonly footnote: Locator = this.table.locator('tfoot');

  override async waitUntilReady(): Promise<void> {
    await expect(this.accountRows.first()).toBeVisible();
  }

  accountLink(accountId: number): Locator {
    return this.table.getByRole('link', { name: String(accountId), exact: true });
  }

  row(accountId: number): Locator {
    return this.accountRows.filter({ has: this.accountLink(accountId) });
  }

  async readRows(): Promise<OverviewRow[]> {
    await this.waitUntilReady();
    const rows = await this.accountRows.all();
    return Promise.all(
      rows.map(async (r) => {
        const cells = r.locator('td');
        return {
          accountId: Number(await cells.nth(0).innerText()),
          balanceCents: parseMoney(await cells.nth(1).innerText()),
          availableCents: parseMoney(await cells.nth(2).innerText()),
        };
      }),
    );
  }

  async totalCents(): Promise<number> {
    return parseMoney(await this.totalRow.locator('td').nth(1).innerText());
  }

  async openAccount(accountId: number): Promise<void> {
    await this.accountLink(accountId).click();
  }
}
