import { expect, test, type Locator } from '@playwright/test';
import type { Address } from '../../api/types';
import { BasePage } from '../BasePage';

export type ProfileField =
  | 'customer.firstName'
  | 'customer.lastName'
  | 'customer.address.street'
  | 'customer.address.city'
  | 'customer.address.state'
  | 'customer.address.zipCode'
  | 'customer.phoneNumber';

export interface ProfileValues {
  firstName: string;
  lastName: string;
  address: Address;
  phoneNumber: string;
}

/**
 * updateprofile.htm. Inputs are pre-filled by a customer XHR AFTER load; filling before it
 * lands gets overwritten, so waitUntilReady() waits for a non-empty first name.
 */
export class UpdateProfilePage extends BasePage {
  protected readonly path = 'updateprofile.htm';

  readonly submit: Locator = this.page
    .locator('#updateProfileForm')
    .getByRole('button', { name: 'Update Profile' });
  readonly result: Locator = this.page.locator('#updateProfileResult');
  readonly error: Locator = this.page.locator('#updateProfileError');

  field(name: ProfileField): Locator {
    return this.page.locator(`[id="${name}"]`);
  }

  /** Error spans: #firstName-error, #lastName-error, #street-error, #city-error, #state-error, #zipCode-error. */
  fieldError(key: 'firstName' | 'lastName' | 'street' | 'city' | 'state' | 'zipCode'): Locator {
    return this.page.locator(`#${key}-error`);
  }

  override async waitUntilReady(): Promise<void> {
    await expect(this.field('customer.firstName')).not.toHaveValue('');
  }

  async readValues(): Promise<ProfileValues> {
    await this.waitUntilReady();
    const v = (f: ProfileField) => this.field(f).inputValue();
    return {
      firstName: await v('customer.firstName'),
      lastName: await v('customer.lastName'),
      address: {
        street: await v('customer.address.street'),
        city: await v('customer.address.city'),
        state: await v('customer.address.state'),
        zipCode: await v('customer.address.zipCode'),
      },
      phoneNumber: await v('customer.phoneNumber'),
    };
  }

  async update(values: Partial<Record<ProfileField, string>>): Promise<void> {
    await test.step('update contact info', async () => {
      await this.waitUntilReady();
      for (const [name, value] of Object.entries(values)) {
        await this.field(name as ProfileField).fill(value);
      }
      await this.submit.click();
    });
  }
}
