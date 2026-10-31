import type { Locator, Page } from '@playwright/test';

/** #headerPanel links. Products and Locations leave the site (parasoft.com, same tab). */
export class HeaderNav {
  readonly root: Locator;
  readonly aboutUs: Locator;
  readonly services: Locator;
  readonly products: Locator;
  readonly locations: Locator;
  readonly adminPage: Locator;

  constructor(page: Page) {
    this.root = page.locator('#headerPanel');
    this.aboutUs = this.root.getByRole('link', { name: 'About Us' });
    this.services = this.root.getByRole('link', { name: 'Services' });
    this.products = this.root.getByRole('link', { name: 'Products' });
    this.locations = this.root.getByRole('link', { name: 'Locations' });
    this.adminPage = this.root.getByRole('link', { name: 'Admin Page' });
  }
}
