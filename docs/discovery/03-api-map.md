# 03 - ParaBank REST API Map (Discovery)

Date: 2026-10-31. Target: shared public instance `https://parabank.parasoft.com/parabank`.
Everything marked **verified** was exercised live with curl today against a throwaway user
(`pwapi1793433665`, customerId 17318). Items marked **docs only** come from the OpenAPI/WADL and were
deliberately not called (destructive or global).

## 1. Where the contract lives

| Resource | URL | Notes |
|---|---|---|
| OpenAPI 3.0.1 (JSON) | `/parabank/services/bank/openapi.json` | Best source for codegen. `servers: /parabank/services/bank` |
| OpenAPI (YAML) | `/parabank/services/bank/openapi.yaml` | Same content |
| WADL | `/parabank/services/bank?_wadl` | CXF generated; same 27 operations |
| Swagger UI | `/parabank/api-docs/` (`/api-docs` 302s here) | Human browsing |
| CXF service list | `/parabank/services` | Also lists SOAP `ParaBank`, `LoanProcessor`, Bookstore services |
| `services_proxy` | `/parabank/services_proxy/bank/...` | **404** (`application/problem+json`) today. Do not use. |

REST base path for the framework: `https://parabank.parasoft.com/parabank/services/bank`.

## 2. Formats and conventions (verified)

- **Default response is XML.** Send `Accept: application/json` on every call to get JSON.
- No authentication of any kind: no token, cookie, or API key is needed for any endpoint.
- All write operations take **query-string parameters** on a `POST` with an empty body (except
  `billpay`, which also needs a JSON or XML `Payee` body).
- Money is a JSON number with 2 decimal places (`515.50`, `-99799.00`). Compare in cents.
- `Transaction.date` is **epoch milliseconds** in JSON (`1793404800000`) and ISO in XML
  (`2026-10-31T00:00:00.000Z`). It is date-only (midnight UTC). There is no time-of-day, so you cannot
  order same-day transactions by date. Use `id` instead.
- `LoanResponse.responseDate` is epoch ms *with* a time part.
- IDs are **not contiguous**. Consecutive accounts got 22557, 22668, 22779 (+111). Never compute IDs.
- Enum casing differs between models: `Account.type` = `CHECKING|SAVINGS|LOAN`, but
  `Transaction.type` = `Credit|Debit`.

### Error response taxonomy (verified, important for the API client)

| Situation | Status | Content-Type | Body |
|---|---|---|---|
| Entity id not found (customer/account/transaction) | 400 | `text/plain` | e.g. `Could not find account #1` |
| Bad login | 400 | `text/plain` | `Invalid username and/or password` |
| Path/query value of wrong type (`/accounts/abc`, `amount=abc`, `newAccountType=SAVINGS`) | 404 | none | empty |
| Missing required query param, invalid enum (`type/Foo`, `month/10`, `newAccountType=7`), malformed JSON body | 500 | `text/html` | full ParaBank HTML error page ("An internal error has occurred") |
| `billpay` without a body | 415 | none | empty |
| Rate limited by Cloudflare | 429 | `text/plain` | `error code: 1015`, `Retry-After: ~288` |

The client must treat **every non-2xx as text** and never call `.json()` blindly.

## 3. Endpoint table

Base: `/parabank/services/bank`. "Resp" is the JSON shape with `Accept: application/json`.

| # | Method + path | Params | Resp (2xx) | Bad-input behaviour (verified) |
|---|---|---|---|---|
| 1 | `GET /login/{username}/{password}` | path | `Customer` | 400 text `Invalid username and/or password` |
| 2 | `GET /customers/{customerId}` | path | `Customer` | 400 `Could not find customer #N`; 404 non-numeric |
| 3 | `GET /customers/{customerId}/accounts` | path | `Account[]` | (as above) |
| 4 | `POST /customers/update/{customerId}` | query: firstName, lastName, street, city, state, zipCode, phoneNumber, ssn, username, password (**all required**) | text `Successfully updated customer profile` | missing field: 500 HTML. **Non-existent customerId: 200 "Successfully updated"** (false success) |
| 5 | `GET /accounts/{accountId}` | path | `Account` | 400 `Could not find account #N`; 404 non-numeric |
| 6 | `POST /createAccount` | query: customerId, newAccountType (int: **0=CHECKING, 1=SAVINGS, 2=LOAN**), fromAccountId | `Account` | bad/missing fromAccountId: 400 `Could not create new account for customer X from account Y`; type `7`: 500 HTML; type `SAVINGS`: 404 |
| 7 | `POST /transfer` | query: fromAccountId, toAccountId, amount | text `Successfully transferred $25.5 from account #A to account #B` | unknown account: 400 `Could not find account number A and/or B`; missing amount: 500 HTML; `amount=abc`: 404 |
| 8 | `POST /deposit` | query: accountId, amount | text `Successfully deposited $50 to account #N` | unknown account: 400 |
| 9 | `POST /withdraw` | query: accountId, amount | text `Successfully withdrew $20 from account #N` | unknown account: 400 `Could not find account number N` |
| 10 | `POST /billpay` | query: accountId, amount; body: `Payee` (JSON/XML) | `BillPayResult` | no body: 415; unknown account or bad JSON: 500 HTML |
| 11 | `POST /requestLoan` | query: customerId, amount, downPayment, fromAccountId | `LoanResponse` | unknown fromAccount: 400; **declined loan is 200** with `approved:false` |
| 12 | `GET /accounts/{id}/transactions` | path | `Transaction[]` | unknown: 400 `Could not find transactions for account #N` |
| 13 | `GET /transactions/{transactionId}` | path | `Transaction` | 400 `Could not find transaction #N`; 404 non-numeric |
| 14 | `GET /accounts/{id}/transactions/amount/{amount}` | path | `Transaction[]` | `25.5` and `25.50` both match; no match: `[]` |
| 15 | `GET /accounts/{id}/transactions/onDate/{onDate}` | `MM-dd-yyyy` | `Transaction[]` | **ISO `2026-10-31` silently returns `[]`** |
| 16 | `GET /accounts/{id}/transactions/fromDate/{from}/toDate/{to}` | `MM-dd-yyyy` | `Transaction[]` | ISO dates silently `[]` |
| 17 | `GET /accounts/{id}/transactions/month/{month}/type/{type}` | month: `October`/`Oct`/`All`; type: `Credit`/`Debit`/`All` | `Transaction[]` | `month/10` or `type/CREDIT` / `Foo`: 500 HTML |
| 18 | `GET /customers/{customerId}/positions` | path | `Position[]` | new user: `[]` |
| 19 | `POST /customers/{customerId}/buyPosition` | query: accountId, name, symbol, shares, pricePerShare | `Position[]` | docs only |
| 20 | `POST /customers/{customerId}/sellPosition` | query: accountId, positionId, shares, pricePerShare | `Position[]` | docs only |
| 21 | `GET /positions/{positionId}` | path | `Position` | docs only |
| 22 | `GET /positions/{positionId}/{startDate}/{endDate}` | path | `HistoryPoint[]` | docs only |
| 23 | `POST /initializeDB` | none | empty | **docs only. Global reset. Never call on the shared instance.** |
| 24 | `POST /cleanDB` | none | empty | **docs only. Wipes all data. Never call on the shared instance.** |
| 25 | `POST /setParameter/{name}/{value}` | path | empty | **docs only. Changes global admin settings for everyone.** |
| 26 | `POST /startupJmsListener`, `POST /shutdownJmsListener` | none | empty | docs only, global |

**There is no endpoint to create a customer/user**, and none to delete a customer, account, or
transaction. This is confirmed by the OpenAPI, the WADL, and the SOAP `ParaBank` operation list on
`/parabank/services`.

### Text-success gotcha

`transfer`, `deposit`, `withdraw` and `customers/update` return a **plain sentence with
`Content-Type: application/json`** (or `application/xml`). It is not valid JSON, so `response.json()`
throws. Use `response.text()` and check `ok()`. Assert state with a follow-up `GET`, not by parsing
the sentence.

## 4. Verified JSON shapes -> TypeScript interfaces

Samples (verified, `Accept: application/json`):

```json
// GET /login/{u}/{p}  and  GET /customers/{id}
{"id":17318,"firstName":"Api","lastName":"Probe","address":{"street":"1 Test St","city":"Testville","state":"CA","zipCode":"90001"},"phoneNumber":"5551234567","ssn":"123-45-6789"}

// GET /customers/{id}/accounts
[{"id":22002,"customerId":17318,"type":"CHECKING","balance":515.50}]

// POST /createAccount (note balance 0 in the response; see gotcha G4)
{"id":22557,"customerId":17318,"type":"SAVINGS","balance":0}

// GET /transactions/{id}
{"id":30682,"accountId":22557,"type":"Credit","date":1793404800000,"amount":25.50,"description":"Funds Transfer Received"}

// POST /billpay
{"payeeName":"Electric Co","amount":12.34,"accountId":22557}

// POST /requestLoan (approved / declined)
{"responseDate":1793434112488,"loanProviderName":"Wealth Securities Dynamic Loans (WSDL)","approved":true,"accountId":26775}
{"responseDate":1793434115341,"loanProviderName":"Wealth Securities Dynamic Loans (WSDL)","approved":false,"message":"error.insufficient.funds","accountId":null}
```

Observed transaction descriptions: `Funds Transfer Sent`, `Funds Transfer Received` (a transfer
creates a Debit on the source and a Credit on the target). A new account created via `createAccount`
also produces a `Funds Transfer Sent` debit of the minimum balance on the source.

```ts
export interface Address { street: string; city: string; state: string; zipCode: string; }

export interface Customer {
  id: number; firstName: string; lastName: string;
  address: Address; phoneNumber: string; ssn: string;
}

export type AccountType = 'CHECKING' | 'SAVINGS' | 'LOAN';
export const NewAccountType = { CHECKING: 0, SAVINGS: 1, LOAN: 2 } as const;

export interface Account { id: number; customerId: number; type: AccountType; balance: number; }

export interface Transaction {
  id: number; accountId: number; type: 'Credit' | 'Debit';
  date: number;            // epoch ms, midnight UTC (JSON); ISO string in XML
  amount: number; description: string;
}

export interface Payee {
  name: string; address: Address; phoneNumber: string; accountNumber: number;
}
export interface BillPayResult { payeeName: string; amount: number; accountId: number; }

export interface LoanResponse {
  responseDate: number;    // epoch ms with time
  loanProviderName: string;
  approved: boolean;
  message?: string;        // e.g. 'error.insufficient.funds' when declined
  accountId: number | null;
}

export interface Position {   // from OpenAPI, not exercised
  positionId: number; customerId: number; name: string; symbol: string;
  shares: number; purchasePrice: number;
}
export interface HistoryPoint { symbol: string; date: string; closingPrice: number; } // OpenAPI
```

## 5. User creation: UI-only, but a plain HTTP form POST works (verified)

There is no REST/SOAP operation for creating a customer. Registration is the `register.htm` Spring MVC
form, and it can be driven without a browser:

1. `GET /parabank/register.htm`. **This is required.** It creates the `JSESSIONID` session that the
   form's backing object depends on. A POST without a prior GET returned **500** ("An internal error
   has occurred") every time, even with valid data.
2. `POST /parabank/register.htm` (`application/x-www-form-urlencoded`) with the same cookie jar:
   `customer.firstName`, `customer.lastName`, `customer.address.street`, `customer.address.city`,
   `customer.address.state`, `customer.address.zipCode`, `customer.phoneNumber`, `customer.ssn`,
   `customer.username`, `customer.password`, `repeatedPassword`.
3. Success returns **200** with HTML containing `<h1 class="title">Welcome {username}` and
   `Your account was created successfully. You are now logged in.` **That session is now logged in.**
4. Resolve the customerId with `GET /services/bank/login/{username}/{password}` -> `Customer.id`.

Validation failures also return **200**. Detect them in the HTML (`span.error` /
`class="error"`), for example `This username already exists.` or `Passwords did not match.`. Do not
rely on the status code.

The new user automatically gets **one CHECKING account with balance 515.50** (admin `initialBalance`).

Logging in without the UI also works. `POST /parabank/login.htm` with `username` and `password` (no
prior GET needed) returns **302 -> overview.htm** and sets `JSESSIONID` (cookie path `/parabank`,
HttpOnly). A bad login returns 200 with `The username and password could not be verified.`

## 6. Recommended data-seeding strategy

**A worker- or test-scoped Playwright fixture that seeds over HTTP, then hands the UI a logged-in
context.**

```ts
// sketch, not project code
async function registerUser(ctx: APIRequestContext, u: NewUser) {
  await ctx.get('/parabank/register.htm');                       // must come first (session)
  const res = await ctx.post('/parabank/register.htm', { form: toRegisterForm(u) });
  const html = await res.text();
  if (!html.includes(`Welcome ${u.username}`)) throw new Error(extractError(html));
  const c = await ctx.get(`/parabank/services/bank/login/${encodeURIComponent(u.username)}/${encodeURIComponent(u.password)}`,
                          { headers: { Accept: 'application/json' } });
  return (await c.json()) as Customer;
}
```

1. **User**: generate a unique username (`pw_${workerIndex}_${Date.now().toString(36)}`, max ~20 chars,
   alphanumeric). Use an alphanumeric password with no `/`, `%`, `?` or `#`, because it is placed in a
   URL **path** segment in `/login/{u}/{p}`. Register with `page.context().request` (or
   `browser.newContext()` + `context.request`) so the cookie jar is **shared with the page**. The page
   is then already logged in, with no UI login step. Alternatively, call `login.htm` and save the
   `storageState` per worker.
2. **Accounts**: `POST /createAccount` with `newAccountType` 0/1/2 and `fromAccountId` = the default
   checking account. Each new account moves the admin `minimumBalance` (**100.00**) from the source.
   With 515.50 you can create at most 4 before the source goes low. Overdraft is allowed, so it does
   not fail, but the balances look odd. If you need more funds or a precise opening balance, call
   `POST /deposit` first (unbounded).
3. **Transactions/history**: use `transfer` / `deposit` / `withdraw` / `billpay` via API to build
   history for read-only UI tests (Find Transactions, Account Activity).
4. **Cross-verification**: after a UI action, `GET /accounts/{id}` and
   `GET /accounts/{id}/transactions` and assert in cents. For "find by amount/date" UI checks, use the
   matching API endpoint with `MM-dd-yyyy` dates.
5. **Teardown**: there is **nothing to delete with**: no delete-customer/account endpoint. Rely on
   uniqueness and isolation (fresh user per test or per worker) instead of cleanup. Never use
   `cleanDB`/`initializeDB` on the shared host.
6. **Prefer per-worker users plus per-test accounts.** That keeps registrations (HTML, slower and
   rate-limited) to one per worker, and each test still gets isolated accounts.

Register through the browser UI only in the dedicated registration test(s). Everything else seeds
over HTTP.

## 7. Gotchas and risks

- **G1 Cloudflare rate limit (verified).** After about 50 requests in about 3 minutes from one IP,
  every call returned `429 error code: 1015` with `Retry-After: 288` (almost 5 minutes, all paths).
  This is the top CI risk: parallel workers on one runner will trip it. Mitigations: keep API calls
  minimal (seed per worker, not per assertion), add a retry wrapper that honours `Retry-After` and
  fails clearly, limit workers (2-3), and **strongly consider running ParaBank locally in Docker** for
  CI (Parasoft publishes a ParaBank image. Verify the current image name and tag before adopting).
  That also removes G2.
- **G2 Shared, mutable, public database.** Anyone can call `cleanDB`/`initializeDB`/`setParameter`
  at any time (all unauthenticated). The data, `john/demo` (currently customerId 12212) and admin
  settings (initial balance, loan provider) can change under a running suite. Never hard-code IDs.
  Look them up at runtime, and read the effective settings defensively.
- **G3 Text bodies labelled as JSON** (`transfer`, `deposit`, `withdraw`, `customers/update`). Use
  `.text()`.
- **G4 `createAccount` response shows `balance: 0`**, but a follow-up `GET` shows `100.00`. Always
  re-read balances. Do not trust the create response.
- **G5 No business validation.** `transfer` accepted `amount=99999` (source went to `-99799.00`),
  `amount=-10` (money moved backwards) and `from == to`, all as 200 "Successfully transferred". The UI
  may validate differently. Tests asserting "insufficient funds" must target the UI, not assume the API
  rejects it. (These are product defects worth reporting in negative tests.)
- **G6 `customers/update` on a non-existent id returns 200 success.** It also requires all 10 fields,
  including username and password, so a partial update is impossible and it can silently change the
  login credentials. Always send the current username/password unless the change is intended.
- **G7 Date formats.** Path dates are `MM-dd-yyyy`. ISO dates return `[]` with 200 (a silent false
  negative). Month is a name (`October`/`Oct`) or `All`, type is `Credit`/`Debit`/`All`
  (case-sensitive). Anything else gives a 500 HTML page. Transactions are dated midnight UTC by the
  server, so near midnight a local-timezone "today" may not match. Compute dates in UTC.
- **G8 Declined loans are HTTP 200** with `approved:false` and `accountId:null`. Current admin
  settings: provider `ws` (Web Service), processor `funds` (Available Funds), threshold `20`. The
  decision depends on these global settings and on the source balance.
- **G9 Registration requires a session** (GET before POST), and its validation errors come back as 200.
- **G10 Error bodies are heterogeneous** (empty 404, text 400, HTML 500, Cloudflare 429 text). Log the
  status and the first ~200 chars of the body in test failures.
- **G11 XML by default.** A missing `Accept` header yields XML, and XML wraps lists as
  `<accounts><account>...`. Set `extraHTTPHeaders: { Accept: 'application/json' }` on the API context.
- **G12 Money as floats.** Values like `100032.16` arrive as JS numbers. Convert to integer cents
  before comparing sums (`Math.round(x * 100)`).

## 8. Admin page (`/parabank/admin.htm`, read only, docs)

Read via GET only. Nothing was submitted.

| Setting | Field | Current value |
|---|---|---|
| Data access mode | `accessMode` radio: `soap`, `restxml`, `restjson`, `jdbc` | `jdbc` |
| SOAP / REST / loan endpoints | `soapEndpoint`, `restEndpoint`, `endpoint` | empty |
| Initial balance (new customers) | `initialBalance` | `515.50` |
| Minimum balance (new account funding) | `minimumBalance` | `100.00` |
| Loan provider | `loanProvider`: `jms`, `ws`, `local` | `ws` |
| Loan processor | `loanProcessor`: `funds`, `down`, `combined` | `funds` |
| Loan processor threshold | `loanProcessorThreshold` | `20` |
| Database buttons | `action=INIT` / `action=CLEAN` | global reset/wipe |
| JMS service | `jms.htm` form (`shutdown=true`) | global |

All of these are writable by anonymous users (form POST or `POST /setParameter/{name}/{value}`).

## 9. Auth model and security notes (brief)

- The REST API is **completely unauthenticated**. Any caller who knows or guesses an id can read any
  customer's PII (name, address, phone, **SSN**), read balances and transactions, move money between
  arbitrary accounts, and change profiles and credentials (BOLA, OWASP API1/API3/API5).
- Credentials travel in the URL path (`/login/{u}/{p}`), so they end up in proxy/CDN logs. Use
  throwaway passwords only, and never real data.
- Global admin/DB operations are anonymous (`cleanDB`, `initializeDB`, `setParameter`, JMS toggles).
- It is a deliberately vulnerable demo, so treat these as context for test design, not as findings to
  fix. Keep the suite's secrets and real personal data out of it.

## 10. Data left behind by this discovery

Throwaway customer `pwapi1793433665` (id 17318) with accounts 22002, 22557, 22668, 22779, 26775. It
has odd balances from the negative/overdraft probes. It cannot be deleted via the API.
