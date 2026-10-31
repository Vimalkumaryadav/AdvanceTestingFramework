import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { CLOUDFLARE_STATUSES, throwIfCloudflare } from '../support/rate-limit';
import { AccountServicesMenu } from './components/AccountServicesMenu';
import { HeaderNav } from './components/HeaderNav';
import { LoginPanel } from './components/LoginPanel';

/**
 * Shared layout for every ParaBank page (verified in docs/discovery/02-ui-map.md section 0.1):
 * #headerPanel / #leftPanel (login panel or Account Services menu) / #rightPanel / #footerPanel.
 */
export abstract class BasePage {
  /** Path relative to BASE_URL, e.g. `overview.htm`. */
  protected abstract readonly path: string;

  readonly header: HeaderNav;
  readonly menu: AccountServicesMenu;
  readonly loginPanel: LoginPanel;
  readonly content: Locator;
  /** Welcome line in the left panel when logged in: "Welcome {First} {Last}". */
  readonly welcome: Locator;
  /** Server-rendered or AJAX error paragraph that is currently visible in the content area. */
  readonly visibleError: Locator;

  constructor(readonly page: Page) {
    this.header = new HeaderNav(page);
    this.menu = new AccountServicesMenu(page);
    this.loginPanel = new LoginPanel(page);
    this.content = page.locator('#rightPanel');
    this.welcome = page.locator('#leftPanel p.smallText');
    this.visibleError = this.content.locator('p.error').filter({ visible: true });
  }

  /** Navigates to this page, fails fast on a Cloudflare ban, then waits for page readiness. */
  async goto(query = ''): Promise<this> {
    const response = await this.page.goto(this.path + query);
    await BasePage.assertNotRateLimited(response, this.page);
    await this.waitUntilReady();
    return this;
  }

  /** Override to wait for AJAX-populated content. Default: nothing extra. */
  async waitUntilReady(): Promise<void> {}

  heading(name: string | RegExp): Locator {
    return this.content.getByRole('heading', { name });
  }

  /** The visible `h1.title` (AJAX pages keep hidden form/result/error headings in the DOM). */
  get title(): Locator {
    return this.content.locator('h1.title').filter({ visible: true });
  }

  /**
   * Fails fast with RATE_LIMITED / CF_CHALLENGE / CF_BLOCK when the navigation landed on a
   * Cloudflare page. Title and body are read only for 403/429/503, never for normal pages.
   */
  static async assertNotRateLimited(response: Response | null, page: Page): Promise<void> {
    if (!response || !CLOUDFLARE_STATUSES.includes(response.status())) return;
    const body = (await response.text().catch(() => '')).slice(0, 4000);
    const title = await page.title().catch(() => '');
    throwIfCloudflare(
      response.status(),
      response.headers(),
      `${title}
${body}`,
      response.url(),
    );
  }

  /**
   * Waits until one of the AJAX outcome containers (result or error view) is displayed.
   * Both containers always exist in the DOM, so filter to the visible one.
   */
  protected async waitForOutcome(result: Locator, error: Locator): Promise<void> {
    await expect(result.or(error).filter({ visible: true }).first()).toBeVisible();
  }

  /** Waits until a <select> has at least one option (they are populated by AJAX after load). */
  protected async waitForOptions(select: Locator): Promise<void> {
    await expect(select.locator('option')).not.toHaveCount(0);
  }
}
