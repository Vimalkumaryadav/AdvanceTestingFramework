import { test, type Locator } from '@playwright/test';
import type { NewUser } from '../../data/factories';
import { BasePage } from '../BasePage';

export type LookupField =
  | 'firstName'
  | 'lastName'
  | 'address.street'
  | 'address.city'
  | 'address.state'
  | 'address.zipCode'
  | 'ssn';

/** lookup.htm ("Forgot login info?"). A successful lookup also logs the customer in. */
export class LookupPage extends BasePage {
  protected readonly path = 'lookup.htm';

  readonly form: Locator;
  readonly submit: Locator;
  /** Success paragraph: "<b>Username</b>: x <br><b>Password</b>: y". */
  readonly credentials: Locator;

  constructor(page: LookupPage['page']) {
    super(page);
    this.form = page.locator('#lookupForm');
    this.submit = this.form.getByRole('button', { name: 'Find My Login Info' });
    this.credentials = this.content.locator('p').filter({ hasText: 'Username' });
  }

  field(name: LookupField): Locator {
    return this.form.locator(`[id="${name}"]`);
  }

  fieldError(name: LookupField): Locator {
    return this.form.locator(`[id="${name}.errors"]`);
  }

  /** Server-rendered required-field errors currently shown. */
  get allFieldErrors(): Locator {
    return this.form.locator('span.error').filter({ visible: true });
  }

  async findLogin(
    user: Pick<NewUser, 'firstName' | 'lastName' | 'address' | 'ssn'>,
  ): Promise<void> {
    await test.step('look up login info', async () => {
      await this.field('firstName').fill(user.firstName);
      await this.field('lastName').fill(user.lastName);
      await this.field('address.street').fill(user.address.street);
      await this.field('address.city').fill(user.address.city);
      await this.field('address.state').fill(user.address.state);
      await this.field('address.zipCode').fill(user.address.zipCode);
      await this.field('ssn').fill(user.ssn);
      await this.submit.click();
    });
  }
}
