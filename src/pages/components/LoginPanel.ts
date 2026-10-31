import { test, type Locator, type Page } from '@playwright/test';

/** #loginPanel in the left column (logged-out state). Inputs have names but no ids or labels. */
export class LoginPanel {
  readonly root: Locator;
  readonly username: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly forgotLoginLink: Locator;
  readonly registerLink: Locator;

  constructor(readonly page: Page) {
    this.root = page.locator('#loginPanel');
    this.username = this.root.locator('input[name="username"]');
    this.password = this.root.locator('input[name="password"]');
    this.submit = this.root.getByRole('button', { name: 'Log In' });
    this.forgotLoginLink = this.root.getByRole('link', { name: 'Forgot login info?' });
    this.registerLink = this.root.getByRole('link', { name: 'Register' });
  }

  /** Classic form POST: navigates to overview.htm on success, login.htm with an error otherwise. */
  async login(username: string, password: string): Promise<void> {
    await test.step(`log in as "${username}"`, async () => {
      await this.username.fill(username);
      await this.password.fill(password);
      await this.submit.click();
    });
  }
}
