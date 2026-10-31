import type { APIRequestContext } from '@playwright/test';
import { sendGuarded } from '../support/rate-limit';
import { formatApiDate } from '../utils/dates';
import type {
  Account,
  BillPayResult,
  Customer,
  CustomerUpdate,
  LoanResponse,
  Month,
  NewAccountTypeName,
  Payee,
  Transaction,
  TransactionType,
} from './types';
import { NewAccountType } from './types';

export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${url} -> HTTP ${status}: ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
    this.name = 'ApiError';
  }
}

type Params = Record<string, string | number>;

interface SendOptions {
  params?: Params;
  data?: unknown;
}

/**
 * Typed client for ParaBank's unauthenticated REST API (`/parabank/services/bank`).
 *
 * Construct it with an APIRequestContext whose baseURL is `env.apiBaseUrl` and which sends
 * `Accept: application/json` (otherwise the server answers XML). The `api` fixture does this.
 *
 * Handles three quirks:
 *  - success bodies that are plain sentences labelled application/json (transfer/deposit/...)
 *  - heterogeneous error bodies (text 400, empty 404, HTML 500): every non-2xx becomes ApiError
 *  - Cloudflare: 429 retried once within RATE_LIMIT_MAX_WAIT_S, a challenge replayed once, else
 *    RATE_LIMITED / CF_CHALLENGE / CF_BLOCK
 */
export class ParaBankApiClient {
  /** Network time (ms) of the most recent request, excluding pacing/ban waits. */
  lastDurationMs = 0;

  constructor(private readonly request: APIRequestContext) {}

  // ---------- customers ----------

  login(username: string, password: string): Promise<Customer> {
    return this.json<Customer>(
      'GET',
      `login/${encodeURIComponent(username)}/${encodeURIComponent(password)}`,
    );
  }

  getCustomer(customerId: number): Promise<Customer> {
    return this.json<Customer>('GET', `customers/${customerId}`);
  }

  /** All 10 fields are required by the server; send current credentials unless changing them. */
  updateCustomer(customerId: number, update: CustomerUpdate): Promise<string> {
    return this.text('POST', `customers/update/${customerId}`, { params: { ...update } });
  }

  // ---------- accounts ----------

  getAccounts(customerId: number): Promise<Account[]> {
    return this.json<Account[]>('GET', `customers/${customerId}/accounts`);
  }

  getAccount(accountId: number): Promise<Account> {
    return this.json<Account>('GET', `accounts/${accountId}`);
  }

  /** NOTE: the response reports balance 0; re-read with getAccount for the real balance. */
  createAccount(
    customerId: number,
    type: NewAccountTypeName,
    fromAccountId: number,
  ): Promise<Account> {
    return this.json<Account>('POST', 'createAccount', {
      params: { customerId, newAccountType: NewAccountType[type], fromAccountId },
    });
  }

  transfer(fromAccountId: number, toAccountId: number, amount: number): Promise<string> {
    return this.text('POST', 'transfer', { params: { fromAccountId, toAccountId, amount } });
  }

  deposit(accountId: number, amount: number): Promise<string> {
    return this.text('POST', 'deposit', { params: { accountId, amount } });
  }

  withdraw(accountId: number, amount: number): Promise<string> {
    return this.text('POST', 'withdraw', { params: { accountId, amount } });
  }

  billPay(accountId: number, amount: number, payee: Payee): Promise<BillPayResult> {
    return this.json<BillPayResult>('POST', 'billpay', {
      params: { accountId, amount },
      data: payee,
    });
  }

  /** Declined loans are HTTP 200 with approved:false. */
  requestLoan(
    customerId: number,
    amount: number,
    downPayment: number,
    fromAccountId: number,
  ): Promise<LoanResponse> {
    return this.json<LoanResponse>('POST', 'requestLoan', {
      params: { customerId, amount, downPayment, fromAccountId },
    });
  }

  // ---------- transactions ----------

  getTransactions(accountId: number): Promise<Transaction[]> {
    return this.json<Transaction[]>('GET', `accounts/${accountId}/transactions`);
  }

  getTransaction(transactionId: number): Promise<Transaction> {
    return this.json<Transaction>('GET', `transactions/${transactionId}`);
  }

  findTransactionsByAmount(accountId: number, amount: number): Promise<Transaction[]> {
    return this.json<Transaction[]>('GET', `accounts/${accountId}/transactions/amount/${amount}`);
  }

  /** Dates must be MM-dd-yyyy; ISO silently returns []. */
  findTransactionsOnDate(accountId: number, date: Date): Promise<Transaction[]> {
    return this.json<Transaction[]>(
      'GET',
      `accounts/${accountId}/transactions/onDate/${formatApiDate(date)}`,
    );
  }

  findTransactionsInRange(accountId: number, from: Date, to: Date): Promise<Transaction[]> {
    return this.json<Transaction[]>(
      'GET',
      `accounts/${accountId}/transactions/fromDate/${formatApiDate(from)}/toDate/${formatApiDate(to)}`,
    );
  }

  findTransactionsByMonthAndType(
    accountId: number,
    month: Month,
    type: TransactionType | 'All',
  ): Promise<Transaction[]> {
    return this.json<Transaction[]>(
      'GET',
      `accounts/${accountId}/transactions/month/${month}/type/${type}`,
    );
  }

  // ---------- transport ----------

  private async json<T>(method: string, path: string, opts?: SendOptions): Promise<T> {
    const body = await this.text(method, path, opts);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new ApiError(method, path, 200, `Expected JSON but got: ${body}`);
    }
  }

  /**
   * Returns the raw body of a 2xx response; throws ApiError for other statuses. Cloudflare
   * answers become RATE_LIMITED / CF_CHALLENGE / CF_BLOCK (see sendGuarded for the retry rules).
   * `lastDurationMs` is the network time of the last request only (pacing waits excluded).
   */
  private async text(method: string, path: string, opts: SendOptions = {}): Promise<string> {
    const res = await sendGuarded(async () => {
      const started = performance.now();
      const response = await this.request.fetch(path, {
        method,
        params: opts.params,
        data: opts.data,
        failOnStatusCode: false,
      });
      this.lastDurationMs = Math.round(performance.now() - started);
      return response;
    });
    const body = await res.text();
    if (!res.ok()) throw new ApiError(method, res.url(), res.status(), body);
    return body;
  }
}
