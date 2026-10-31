import { test, type Locator } from '@playwright/test';
import { BasePage } from '../BasePage';

export type ContactField = 'name' | 'email' | 'phone' | 'message';

/** contact.htm ("Customer Care"). Server-validated form POST. */
export class ContactPage extends BasePage {
  protected readonly path = 'contact.htm';

  readonly form: Locator;
  readonly submit: Locator;

  constructor(page: ContactPage['page']) {
    super(page);
    this.form = page.locator('#contactForm');
    this.submit = this.form.getByRole('button', { name: 'Send to Customer Care' });
  }

  field(name: ContactField): Locator {
    return this.form.locator(`#${name}`);
  }

  fieldError(name: ContactField): Locator {
    return this.form.locator(`[id="${name}.errors"]`);
  }

  /** Server-rendered required-field errors currently shown. */
  get allFieldErrors(): Locator {
    return this.form.locator('span.error').filter({ visible: true });
  }

  async send(values: Record<ContactField, string>): Promise<void> {
    await test.step('send customer-care message', async () => {
      for (const [k, v] of Object.entries(values)) await this.field(k as ContactField).fill(v);
      await this.submit.click();
    });
  }
}
