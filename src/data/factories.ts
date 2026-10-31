/**
 * Test-data factories.
 *
 * Realistic fields come from faker, re-seeded per test (TEST_SEED XOR hash(testId)) so a failing
 * test's data can be reproduced. Fields that must be globally unique on the shared public
 * instance (username, SSN) deliberately mix in time + crypto randomness, because a seeded value
 * would collide with the previous run's user.
 */
import { randomInt } from 'node:crypto';
import { faker } from '@faker-js/faker';
import type { Address, Payee } from '../api/types';
import { env } from '../config/env';

export interface NewUser {
  firstName: string;
  lastName: string;
  address: Address;
  phoneNumber: string;
  ssn: string;
  username: string;
  password: string;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Re-seeds faker for one test. Called by the auto fixture; returns the effective seed. */
export function seedFaker(testId: string): number {
  const seed = (env.testSeed ^ hash(testId)) >>> 0;
  faker.seed(seed);
  return seed;
}

const lettersOnly = (s: string) => s.replace(/[^A-Za-z]/g, '') || 'Test';

/** Alphanumeric, <= 14 chars, unique across runs and workers. */
export function uniqueUsername(prefix = 'pw'): string {
  return `${prefix}${Date.now().toString(36)}${randomInt(36 ** 3)
    .toString(36)
    .padStart(3, '0')}`;
}

/** Random ###-##-#### SSN. Unique SSNs matter: Forgot Login fails when an SSN is shared. */
export function uniqueSsn(): string {
  const digits = String(randomInt(100_000_000, 1_000_000_000));
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** Password safe for the `/login/{u}/{p}` path segment (alphanumeric only). */
export function password(): string {
  return `Pw${faker.string.alphanumeric(8)}9`;
}

export function buildAddress(overrides: Partial<Address> = {}): Address {
  return {
    street: faker.location.streetAddress(false),
    city: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    zipCode: faker.location.zipCode('#####'),
    ...overrides,
  };
}

export function buildUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    firstName: lettersOnly(faker.person.firstName()),
    lastName: lettersOnly(faker.person.lastName()),
    address: buildAddress(),
    phoneNumber: faker.string.numeric({ length: 10, allowLeadingZeros: false }),
    ssn: uniqueSsn(),
    username: uniqueUsername(),
    password: password(),
    ...overrides,
  };
}

export function buildPayee(overrides: Partial<Payee> = {}): Payee {
  return {
    name: `${faker.company.name().replace(/[^A-Za-z0-9 ]/g, '')} Utility`,
    address: buildAddress(),
    phoneNumber: faker.string.numeric({ length: 10, allowLeadingZeros: false }),
    accountNumber: Number(faker.string.numeric({ length: 6, allowLeadingZeros: false })),
    ...overrides,
  };
}

/**
 * A distinctive money amount in cents (e.g. 1234 -> $12.34) so find-by-amount
 * assertions do not match unrelated transactions.
 */
export function distinctiveCents(min = 1_001, max = 9_999): number {
  return faker.number.int({ min, max });
}

/** Form-field map for register.htm (names verified in docs/discovery/02-ui-map.md section 1.2). */
export function toRegisterForm(user: NewUser): Record<string, string> {
  return {
    'customer.firstName': user.firstName,
    'customer.lastName': user.lastName,
    'customer.address.street': user.address.street,
    'customer.address.city': user.address.city,
    'customer.address.state': user.address.state,
    'customer.address.zipCode': user.address.zipCode,
    'customer.phoneNumber': user.phoneNumber,
    'customer.ssn': user.ssn,
    'customer.username': user.username,
    'customer.password': user.password,
    repeatedPassword: user.password,
  };
}
