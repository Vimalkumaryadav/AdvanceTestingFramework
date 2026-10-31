import { test, type Locator } from '@playwright/test';
import type { NewUser } from '../../data/factories';
import { toRegisterForm } from '../../data/factories';
import { BasePage } from '../BasePage';

export type RegisterField = keyof ReturnType<typeof toRegisterForm>;

/**
 * register.htm. Server-side validated form POST. Ids contain dots (customer.firstName), so
 * locate with [id="..."]. getByLabel does not work on this site: there are no <label> elements.
 */
export class RegisterPage extends BasePage {
  protected readonly path = 'register.htm';

  readonly form: Locator;
  readonly submit: Locator;

  constructor(page: RegisterPage['page']) {
    super(page);
    this.form = page.locator('#customerForm');
    this.submit = this.form.getByRole('button', { name: 'Register' });
  }

  field(name: RegisterField): Locator {
    return this.form.locator(`[id="${name}"]`);
  }

  /** Server-rendered error span next to a field, e.g. [id="customer.username.errors"]. */
  fieldError(name: RegisterField): Locator {
    return this.form.locator(`[id="${name}.errors"]`);
  }

  get allFieldErrors(): Locator {
    return this.form.locator('span.error');
  }

  async fill(user: NewUser, overrides: Partial<Record<RegisterField, string>> = {}): Promise<void> {
    const values = { ...toRegisterForm(user), ...overrides };
    for (const [name, value] of Object.entries(values)) {
      await this.field(name).fill(value ?? '');
    }
  }

  async register(
    user: NewUser,
    overrides: Partial<Record<RegisterField, string>> = {},
  ): Promise<void> {
    await test.step(`register "${overrides['customer.username'] ?? user.username}" via UI`, async () => {
      await this.fill(user, overrides);
      await this.submit.click();
    });
  }
}
