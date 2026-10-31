import type { Locator } from '@playwright/test';
import { BasePage } from '../BasePage';

/** about.htm: static text. */
export class AboutPage extends BasePage {
  protected readonly path = 'about.htm';
}

/** services.htm: static SOAP/REST service listing. */
export class ServicesPage extends BasePage {
  protected readonly path = 'services.htm';
}

/** sitemap.htm: links to every public and account page. */
export class SiteMapPage extends BasePage {
  protected readonly path = 'sitemap.htm';
}

/**
 * admin.htm: PUBLIC and GLOBAL. Read-only use only. Never click Initialize/Clean/Shutdown/Submit
 * against a shared instance: they change state for every user of the site.
 */
export class AdminPage extends BasePage {
  protected readonly path = 'admin.htm';

  readonly initialBalance: Locator = this.page.locator('#initialBalance');
  readonly minimumBalance: Locator = this.page.locator('#minimumBalance');
  readonly loanProvider: Locator = this.page.locator('#loanProvider');
  readonly loanProcessor: Locator = this.page.locator('#loanProcessor');
  readonly loanProcessorThreshold: Locator = this.page.locator('#loanProcessorThreshold');
  readonly accessMode: Locator = this.page.locator('input[name="accessMode"]');
}
