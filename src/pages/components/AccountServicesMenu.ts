import type { Locator, Page } from '@playwright/test';

export const MENU_ITEMS = [
  'Open New Account',
  'Accounts Overview',
  'Transfer Funds',
  'Bill Pay',
  'Find Transactions',
  'Update Contact Info',
  'Request Loan',
  'Log Out',
] as const;
export type MenuItem = (typeof MENU_ITEMS)[number];

/**
 * Left-panel "Account Services" links (logged-in state). Scoped to #leftPanel because
 * "Open New Account" is also a button and "Transfer Funds" also a heading.
 */
export class AccountServicesMenu {
  readonly root: Locator;

  constructor(readonly page: Page) {
    this.root = page.locator('#leftPanel');
  }

  link(item: MenuItem): Locator {
    return this.root.getByRole('link', { name: item, exact: true });
  }

  async open(item: MenuItem): Promise<void> {
    await this.link(item).click();
  }

  async logOut(): Promise<void> {
    await this.open('Log Out');
  }
}
