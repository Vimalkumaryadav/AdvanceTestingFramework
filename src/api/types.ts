/** Shapes verified live against /parabank/services/bank with `Accept: application/json` (see docs/discovery/03-api-map.md). */

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  address: Address;
  phoneNumber: string;
  ssn: string;
}

export type AccountType = 'CHECKING' | 'SAVINGS' | 'LOAN';

/** `createAccount?newAccountType=` takes an int, not the enum name. */
export const NewAccountType = { CHECKING: 0, SAVINGS: 1, LOAN: 2 } as const;
export type NewAccountTypeName = keyof typeof NewAccountType;

export interface Account {
  id: number;
  customerId: number;
  type: AccountType;
  balance: number;
}

export type TransactionType = 'Credit' | 'Debit';

export interface Transaction {
  id: number;
  accountId: number;
  type: TransactionType;
  /** Epoch ms at midnight UTC (date only). */
  date: number;
  amount: number;
  description: string;
}

export interface Payee {
  name: string;
  address: Address;
  phoneNumber: string;
  accountNumber: number;
}

export interface BillPayResult {
  payeeName: string;
  amount: number;
  accountId: number;
}

export interface LoanResponse {
  /** Epoch ms including time of day. */
  responseDate: number;
  loanProviderName: string;
  approved: boolean;
  /** e.g. `error.insufficient.funds` when declined. */
  message?: string;
  accountId: number | null;
}

export type Month =
  | 'All'
  | 'January'
  | 'February'
  | 'March'
  | 'April'
  | 'May'
  | 'June'
  | 'July'
  | 'August'
  | 'September'
  | 'October'
  | 'November'
  | 'December';

export interface CustomerUpdate {
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  phoneNumber: string;
  ssn: string;
  username: string;
  password: string;
}
