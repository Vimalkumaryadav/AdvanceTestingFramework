import { test } from '@playwright/test';
import type { ParaBankApiClient } from '../api/ParaBankApiClient';
import type { Account, NewAccountTypeName } from '../api/types';
import { centsToDecimal, toCents } from '../utils/money';

/**
 * API-side seeding for one customer. Use it to arrange state so UI tests exercise only the
 * journey under test. Every method re-reads from the server: createAccount's own response
 * reports balance 0 even though the account is opened with the minimum balance.
 */
export class AccountsHelper {
  constructor(
    private readonly api: ParaBankApiClient,
    readonly customerId: number,
    readonly primaryAccountId: number,
  ) {}

  list(): Promise<Account[]> {
    return this.api.getAccounts(this.customerId);
  }

  async balanceCents(accountId: number): Promise<number> {
    return toCents((await this.api.getAccount(accountId)).balance);
  }

  /** Opens an account funded (by ParaBank's minimum balance) from `fromAccountId`. */
  async open(
    type: NewAccountTypeName = 'CHECKING',
    fromAccountId = this.primaryAccountId,
  ): Promise<Account> {
    return test.step(`[api] open ${type} account from #${fromAccountId}`, async () => {
      const created = await this.api.createAccount(this.customerId, type, fromAccountId);
      return this.api.getAccount(created.id);
    });
  }

  async deposit(accountId: number, cents: number): Promise<void> {
    await test.step(`[api] deposit ${centsToDecimal(cents)} to #${accountId}`, async () => {
      await this.api.deposit(accountId, Number(centsToDecimal(cents)));
    });
  }

  async transfer(fromAccountId: number, toAccountId: number, cents: number): Promise<void> {
    await test.step(`[api] transfer ${centsToDecimal(cents)} #${fromAccountId} -> #${toAccountId}`, async () => {
      await this.api.transfer(fromAccountId, toAccountId, Number(centsToDecimal(cents)));
    });
  }

  /** Opens an account and tops it up so its balance is at least `minCents`. */
  async openFunded(type: NewAccountTypeName, minCents: number): Promise<Account> {
    const account = await this.open(type);
    const current = toCents(account.balance);
    if (current < minCents) await this.deposit(account.id, minCents - current);
    return this.api.getAccount(account.id);
  }
}
