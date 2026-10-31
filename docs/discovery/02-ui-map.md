# 02 — ParaBank UI Map (verified discovery)

Target: `https://parabank.parasoft.com/parabank/` (public demo instance)
Explored: 2026-10-31, headless Chromium via `@playwright/test` 1.64.1, from Asia (IST, UTC+5:30).
Method: throwaway scripts that drove the live site. Every row below was observed in a real run unless it is marked **[UNVERIFIED]** or **[FROM SOURCE]**. **[FROM SOURCE]** means it was read from the page's inline jQuery and not triggered on purpose.

---

## 0. Cross-cutting facts (read first)

### 0.1 Page layout (every page)
| Region | Locator | Notes |
|---|---|---|
| Header / top nav | `#headerPanel` | Links: About Us, Services, Products, Locations, Admin Page, plus icon links home/about/contact (no text, so target them by `href`). |
| Left panel | `#leftPanel` | Logged out: `#loginPanel` login form. Logged in: `p.smallText` "Welcome {First} {Last}", then the "Account Services" link list. |
| Content | `#rightPanel` | Scope all page assertions here. |
| Footer | `#footerPanel` | Home, About Us, Services, Products, Locations, Site Map, Contact Us. |
| Page heading | `#rightPanel h1.title` | Single-page AJAX views have **several `h1.title` in the DOM** (form, result and error views), and only one is visible. Use `getByRole('heading', { name })`, which skips hidden elements, or scope to the visible container. |

### 0.2 Locator reality
- **No `<label>` elements exist anywhere.** Labels are `<td><b>First Name:</b></td>` table cells. `page.getByLabel('First Name:')` returned **0** matches (verified). Do not use `getByLabel`.
- Use `[id="..."]` or `[name="..."]` attribute selectors. Many ids contain dots (`customer.firstName`). With a CSS `#id` selector, escape the dot (`#customer\\.firstName`), or use `page.locator('[id="customer.firstName"]')` (recommended).
- Buttons are `<input type=submit|button value=...>` or `<button>`. `getByRole('button', { name: 'Register' })` works (verified for Register, Log In, Open New Account, Transfer, Send Payment, Update Profile, Apply Now, Go, Find My Login Info, Send to Customer Care).
- Find Transactions has **four buttons with the same name**. Use their ids (`#findById` and so on).
- CSS `text-transform: uppercase` changes `innerText` (for example "FIND TRANSACTIONS", "INITIALIZE"). The accessible name and the DOM text keep their original case.
- Some pages reuse ids: transfer.htm has two `p#amount.errors` elements; billpay.htm has `span#amount` in its result view. Scope selectors to their container.

### 0.3 Session / URLs
- Session cookie: `JSESSIONID`, domain `parabank.parasoft.com`, path `/parabank`, httpOnly. A saved `storageState` reused in a later browser context stayed logged in across runs (verified for about 10 minutes).
- On the **first** request without a cookie, the server rewrites links with `;jsessionid=XXXX` (for example `about.htm;jsessionid=41A3...`). URL assertions must tolerate this. Use a regex such as `/overview\.htm/`, not string equality.
- Most actions are AJAX and **do not change the URL** (open account, transfer, bill pay, find transactions, update profile, request loan). Only classic form POSTs navigate: register, login, lookup, contact, logout.

### 0.4 Rate limiting (biggest operational risk)
- About 6 minutes of aggressive scripting (roughly 25 page loads plus assets in quick succession) triggered **Cloudflare Error 1015 "You are being rate limited"**. That is HTTP **429**, title `Access denied | parabank.parasoft.com used Cloudflare to restrict access | parabank.parasoft.com | Cloudflare`, with header `retry-after: 254`. The ban covered **all** pages and lasted about 4–5 minutes.
- During the ban, AJAX dropdowns never populate and the page looks like a timeout, not an app error.
- Each page load issues about **19 requests** (1 document, 2 CSS, 1 JS, 15 images). Blocking images (`page.route(/\.(png|jpe?g|gif|ico|svg)(\?|$)/, r => r.abort())`) did not break any flow that was tested, and after it was added no further 429 occurred with about 2.5 s pacing between page loads. **Recommendation:** keep workers low (1–2) against the public instance, block images, set up data through the API, and detect a 429 / "Error 1015" page as an infrastructure failure, not a test failure.

### 0.5 The generic "internal error" view
Every AJAX page ships a hidden error container with `h1.title` "Error!" and `p.error` "An internal error has occurred and has been logged." The page shows it on **any** non-2xx AJAX response, including validation-style 400s. Container ids per page: `#showError` (overview, transfer), `#openAccountError`, `#error` (activity), `#billpayError`, `#errorContainer` (findtrans), `#updateProfileError`, `#requestLoanError`. Server-rendered pages show the same text on a full error page titled `ParaBank | Error`. Spontaneous internal errors or DB resets were **not observed** during this session. **[UNVERIFIED]** whether they occur.

### 0.6 AJAX endpoints (same-origin, cookie-authenticated)
All use the prefix `services_proxy/bank/`. The customer id is hard-coded into each page's inline script (for example `customers/17540/accounts`). `page.request.get(BASE + 'services_proxy/bank/customers/{id}/accounts')` with the logged-in context returned JSON (verified), so it can serve as API-side setup or verification that shares the UI session.

| Purpose | Method + path | Verified response |
|---|---|---|
| List accounts | `GET customers/{cid}/accounts` | `[{"id":22335,"customerId":17540,"type":"CHECKING","balance":315.50},...]` |
| Customer | `GET customers/{cid}` | `{"id","firstName","lastName","address":{...},"phoneNumber","ssn"}` |
| Account | `GET accounts/{aid}` | `{"id","customerId","type","balance"}` |
| Activity | `GET accounts/{aid}/transactions/month/{All|January..}/type/{All|Credit|Debit}` | array (`[]` when empty) |
| All tx | `GET accounts/{aid}/transactions` | array |
| Tx by id | `GET transactions/{txid}` | object; **404** if missing |
| Tx on date | `GET accounts/{aid}/transactions/onDate/{MM-DD-YYYY}` | array |
| Tx range | `GET accounts/{aid}/transactions/fromDate/{d}/toDate/{d}` | array |
| Tx amount | `GET accounts/{aid}/transactions/amount/{n}` | array |
| Open account | `POST createAccount?customerId=&newAccountType=0|1&fromAccountId=` | new account JSON (`id`) |
| Transfer | `POST transfer?fromAccountId=&toAccountId=&amount=` | text `Successfully transferred $25 from account #22335 to account #22890` |
| Bill pay | `POST billpay?accountId=&amount=` with a JSON payee body | `{"payeeName","amount","accountId"}` |
| Update profile | `POST customers/update/{cid}?firstName=...&username=&password=` | 200, text `Successfully updated customer profile` |
| Loan | `POST requestLoan?customerId=&amount=&downPayment=&fromAccountId=` | `{"responseDate","loanProviderName","approved","message"?,"accountId"}` |
| Logged out | any | **401** `{"message":"User login required","status":401}` |

### 0.7 Observed timings (from India to Cloudflare BOM, headless)
| Action | Observed |
|---|---|
| index.htm first load | about 1.5 s; later pages 0.3–0.6 s |
| Register submit to "Customer Created" | 0.4–0.65 s |
| Login submit to overview.htm | about 1.0 s |
| Overview: DOMContentLoaded, then accounts XHR, then table populated | +0.65 s, +0.3 s, about 1.05 s total |
| Open account POST | about 0.3 s; whole click-to-result about 0.4 s |
| Every other AJAX call | 0.27–0.35 s |

Default Playwright timeouts are fine. Never use fixed sleeps. Wait on the XHR or on the visible result container.

---

## 1. Public pages

### 1.1 Home / Login panel — `index.htm`
Title: `ParaBank | Welcome | Online Banking`

| Element | Robust locator | Raw attributes |
|---|---|---|
| Login form | `#loginPanel form[name="login"]` | `action="login.htm"`, POST |
| Username | `#loginPanel input[name="username"]` | `type=text class=input` (no id) |
| Password | `#loginPanel input[name="password"]` | `type=password` (no id) |
| Log In | `getByRole('button', { name: 'Log In' })` | `input[type=submit][value="Log In"]` |
| Forgot login | `getByRole('link', { name: 'Forgot login info?' })` | `lookup.htm` |
| Register | `#loginPanel getByRole('link', { name: 'Register' })` | `register.htm` |

`#loginPanel` contains exactly 2 textboxes (verified).

**Login outcomes (verified)**
| Case | URL after | Title | Message (`#rightPanel p.error`) |
|---|---|---|---|
| Valid | `overview.htm` | `ParaBank | Accounts Overview` | none; `#leftPanel` shows "Welcome {First} {Last}" |
| Wrong password | `login.htm` | `ParaBank | Error` | `The username and password could not be verified.` (h1 `Error!`) |
| Unknown user | `login.htm` | `ParaBank | Error` | `The username and password could not be verified.` |
| Both empty | `login.htm` | `ParaBank | Error` | `Please enter a username and password.` |

Home content is static marketing text. The "Latest News" date heading shows **today's date** (dynamic), so do not assert on it.

### 1.2 Register — `register.htm`
Title: `ParaBank | Register for Free Online Account Access`. H1: `Signing up is easy!`. Form `#customerForm` (POST `register.htm`).

| Field | Locator (id == name) | Required? (verified) | Error span id | Error text |
|---|---|---|---|---|
| First Name | `[id="customer.firstName"]` | yes | `customer.firstName.errors` | `First name is required.` |
| Last Name | `[id="customer.lastName"]` | yes | `customer.lastName.errors` | `Last name is required.` |
| Address | `[id="customer.address.street"]` | yes | `customer.address.street.errors` | `Address is required.` |
| City | `[id="customer.address.city"]` | yes | `customer.address.city.errors` | `City is required.` |
| State | `[id="customer.address.state"]` | yes | `customer.address.state.errors` | `State is required.` |
| Zip Code | `[id="customer.address.zipCode"]` | yes | `customer.address.zipCode.errors` | `Zip Code is required.` |
| Phone # | `[id="customer.phoneNumber"]` | **no** (no error on empty submit) | n/a | n/a |
| SSN | `[id="customer.ssn"]` | yes (format not validated: `123-45-6789` and 9 digits both accepted) | `customer.ssn.errors` | `Social Security Number is required.` |
| Username | `[id="customer.username"]` | yes | `customer.username.errors` | `Username is required.` / `This username already exists.` |
| Password | `[id="customer.password"]` (type=password) | yes | `customer.password.errors` | `Password is required.` |
| Confirm | `[id="repeatedPassword"]` (type=password) | yes | `repeatedPassword.errors` | `Password confirmation is required.` / `Passwords did not match.` |
| Register | `getByRole('button', { name: 'Register' })` | n/a | n/a | n/a |

Error spans are `span.error` with ids like `customer.firstName.errors` (dots again, so use `[id="customer.firstName.errors"]`). Validation is **server-side**: a full POST, then the page re-renders at `register.htm` with the same title.

**Success (verified):** URL stays `register.htm`, title becomes `ParaBank | Customer Created`, h1 is `Welcome {username}`, and the body reads `Your account was created successfully. You are now logged in.` The user is **auto-logged-in** (left panel shows "Welcome {First} {Last}" and the Account Services menu). A new customer gets exactly **one CHECKING account with $515.50** (matches the admin "Init. Balance" setting).

### 1.3 Forgot login info — `lookup.htm`
Title: `ParaBank | Customer Lookup`. H1: `Customer Lookup`. Form `#lookupForm` (POST).

| Field | Locator | Error span / text when empty |
|---|---|---|
| First Name | `#firstName` | `[id="firstName.errors"]` `First name is required.` |
| Last Name | `#lastName` | `[id="lastName.errors"]` `Last name is required.` |
| Address | `[id="address.street"]` | `[id="address.street.errors"]` `Address is required.` |
| City | `[id="address.city"]` | `[id="address.city.errors"]` `City is required.` |
| State | `[id="address.state"]` | `[id="address.state.errors"]` `State is required.` |
| Zip Code | `[id="address.zipCode"]` | `[id="address.zipCode.errors"]` `Zip Code is required.` |
| SSN | `#ssn` | `[id="ssn.errors"]` `Social Security Number is required.` |
| Submit | `getByRole('button', { name: 'Find My Login Info' })` | n/a |

**Outcomes (verified)**
- Success: URL `lookup.htm`, title `ParaBank | Customer Lookup`, text `Your login information was located successfully. You are now logged in.`, then `Username: {u}` and `Password: {p}` in `<p><b>Username</b>: x <br><b>Password</b>: y</p>`. **It also logs the user in.**
- Not found: title `ParaBank | Error`, `p.error` `The customer information provided could not be found.`
- **Gotcha:** a lookup for a user registered with the common SSN `123-45-6789` returned "could not be found" even though every field was correct. The same flow succeeded for a user with a **unique SSN**. Most likely cause: several customers share that SSN. That cause is inferred and was not confirmed. **Always generate a unique SSN per test user.**

### 1.4 About — `about.htm`
Title `ParaBank | About Us`. Static. H1 `ParaSoft Demo Website`. Text includes `ParaBank is not a real bank!`.

### 1.5 Services — `services.htm`
Title `ParaBank | Services`. Static listing of SOAP/REST services (Bookstore, ParaBank WSDL/WADL). Contains endpoint URLs and the demo creds `soatest/soatest`. No forms.

### 1.6 Products / Locations — **off-site**
| Link | href | Final URL observed |
|---|---|---|
| Products | `http://www.parasoft.com/jsp/products.jsp` | `https://www.parasoft.com/products/` |
| Locations | `http://www.parasoft.com/jsp/pr/contacts.jsp` | `https://www.parasoft.com/solutions/` |

Both open in the **same tab** (no `target`). They load heavy third-party scripts (CookieYes, Google Analytics, Algolia). For tests, assert only on the `href` attribute, or `route.abort()` them. Never navigate to them in a merge-blocking suite.

### 1.7 Admin page — `admin.htm`
Title `ParaBank | Administration`. Public, so no login is needed. **Do NOT click Initialize, Clean, Shutdown or Submit against the public instance.** They change the shared server state for every user.

| Element | Locator | Current value (observed) |
|---|---|---|
| DB Initialize | `form[name="initializeDB"] button[value="INIT"]` (text "Initialize") | n/a |
| DB Clean | `form[name="initializeDB"] button[value="CLEAN"]` | n/a |
| JMS status | text `Status: Running`; button `input[value="Shutdown"]` in `form[name="toggleJms"]` | Running |
| Access mode radios | `#accessMode1` soap, `#accessMode2` restxml, `#accessMode3` restjson, `#accessMode4` jdbc (name `accessMode`) | jdbc checked |
| SOAP / REST endpoint | `#soapEndpoint`, `#restEndpoint` | empty |
| Loan processor endpoint | `#endpoint` | empty |
| Init. Balance | `#initialBalance` | `515.50` |
| Min. Balance | `#minimumBalance` | `100.00` |
| Loan Provider | `#loanProvider` options `jms`/`ws`/`local` | (WS observed in loan responses: "Wealth Securities Dynamic Loans (WSDL)") |
| Loan Processor | `#loanProcessor` options `funds`/`down`/`combined` | n/a |
| Threshold | `#loanProcessorThreshold` | `20` (%) |
| Submit | `#adminForm input[value="Submit"]` | n/a |

Links: WSDL `services/ParaBank?wsdl`, WADL `services/bank?_wadl&_type=xml`, OpenAPI `api-docs/index.html`, LoanProcessor WSDL.

### 1.8 Contact — `contact.htm`
Title `ParaBank | Customer Care`. H1 `Customer Care`. Form `#contactForm` (POST).

| Field | Locator | Empty error (span id / text) |
|---|---|---|
| Name | `#name` | `[id="name.errors"]` `Name is required.` |
| Email | `#email` | `[id="email.errors"]` `Email is required.` |
| Phone | `#phone` | `[id="phone.errors"]` `Phone is required.` |
| Message | `#message` (textarea) | `[id="message.errors"]` `Message is required.` |
| Submit | `getByRole('button', { name: 'Send to Customer Care' })` | n/a |

Success (verified): URL `contact.htm`, title unchanged, text `Thank you {Name}` and `A Customer Care Representative will be contacting you.` Email format not validated **[UNVERIFIED]** (only a valid email was tried).

### 1.9 Other public pages seen
- `sitemap.htm` (`ParaBank | Site Map`): links to all public and account pages.
- `news.htm` (`ParaBank | News`): anchors `a#1`..`a#6`. Dates are **relative to today** (dynamic).

---

## 2. Authenticated pages

Left-panel menu (logged in), links in `#leftPanel`, all exact names:
`Open New Account` → `openaccount.htm`, `Accounts Overview` → `overview.htm`, `Transfer Funds` → `transfer.htm`, `Bill Pay` → `billpay.htm`, `Find Transactions` → `findtrans.htm`, `Update Contact Info` → `updateprofile.htm`, `Request Loan` → `requestloan.htm`, `Log Out` → `logout.htm`.

Name collision: "Open New Account" is both a left-panel **link** and the form **button**. "Transfer Funds" is a link and also a heading. Always specify the role, and scope menu clicks to `#leftPanel`.

### 2.1 Logged-out access (verified)
| Page | Result |
|---|---|
| `overview.htm`, `transfer.htm` | HTTP **500**, title `ParaBank | Error`, `An internal error has occurred and has been logged.` (no redirect to login) |
| `activity.htm?id=X` | 200; page shell renders, both XHRs return **401** `User login required`, and the error view gets text `Server returned 401: ...` **[FROM SOURCE]** |

### 2.2 Accounts Overview — `overview.htm`
Title `ParaBank | Accounts Overview`. H1 `Accounts Overview`.
- **AJAX:** `GET services_proxy/bank/customers/{cid}/accounts`. The table body is **empty at DOMContentLoaded** and is populated about 0.3 s later.
- Wait on: `await expect(page.locator('#accountTable tbody tr a').first()).toBeVisible()`, or `page.waitForResponse(/customers\/\d+\/accounts/)`.

| Element | Locator |
|---|---|
| Table | `#accountTable` (thead: Account, Balance*, Available Amount) |
| Account rows | `#accountTable tbody tr:has(a)`; link text = account id; href `activity.htm?id={id}` |
| Account link | `#accountTable getByRole('link', { name: '22335' })` |
| Total row | last `tbody tr`, first cell `Total` (bold), 2nd cell total balance |
| Footnote | `tfoot`: `*Balance includes deposits that may be subject to holds` |
| Error view | `#showError` (hidden normally) |

Format: `$515.50`, negative `-$99703.50` (no thousands separator). "Available Amount" = `max(balance, 0)`.

### 2.3 Open New Account — `openaccount.htm`
Title `ParaBank | Open Account`. H1 `Open New Account`.

| Element | Locator | Notes |
|---|---|---|
| Type | `#type` | options `value="0"` CHECKING, `value="1"` SAVINGS; use `selectOption({ label: 'SAVINGS' })` or `'1'` |
| From account | `#fromAccountId` | **AJAX-populated** (0 options at load). Text: `A minimum of $100.00 must be deposited into this account at time of opening.` |
| Submit | `getByRole('button', { name: 'Open New Account' })` | `input[type=button]` |
| Result view | `#openAccountResult` | h1 `Account Opened!`, `Congratulations, your account is now open.` |
| New account id | `#newAccountId` | text = id, href `activity.htm?id={id}` |
| Error view | `#openAccountError` | n/a |

- **Wait before submit:** `await expect(page.locator('#fromAccountId option')).not.toHaveCount(0)`. **[FROM SOURCE]** The submit handler dereferences `accounts.selectedOption.id`, so clicking before the XHR completes throws a JS error and nothing happens.
- After success (verified): the URL stays `openaccount.htm`, the form is hidden, and `#newAccountId` has text. Wait with `await expect(page.locator('#newAccountId')).toHaveText(/^\d+$/)`.
- Verified for both CHECKING and SAVINGS. The new account starts at **$100.00**, and $100.00 is debited from the source ("Funds Transfer Sent" on the source account). The overview total stays the same.

### 2.4 Account Activity / Details — `activity.htm?id={accountId}`
Title `ParaBank | Account Activity`. H1s `Account Details` and `Account Activity`.
- **AJAX ×2 in parallel:** `GET accounts/{id}` (details) and `GET accounts/{id}/transactions/month/All/type/All`.

| Element | Locator | Example |
|---|---|---|
| Account Number | `#accountId` (td) | `22335` |
| Account Type | `#accountType` | `CHECKING` / `SAVINGS` |
| Balance | `#balance` | `$315.50` |
| Available | `#availableBalance` | `$315.50` |
| Activity Period | `#month` | `All`, `January`…`December` (value == label) |
| Type | `#transactionType` | `All`, `Credit`, `Debit` |
| Go | `getByRole('button', { name: 'Go' })` | submit, prevented; fires a new XHR, **no navigation** |
| Table | `#transactionTable` | cols Date, Transaction, Debit (-), Credit (+) |
| Row link | `#transactionTable tbody a` | text = description, href `transaction.htm?id={txid}` |
| Empty state | `#noTransactions` | `No transactions found.` (the table is **hidden** when empty) |
| Error view | `#error` | n/a |

Filters (verified): October + Debit gave 2 rows. October + Credit gave `#noTransactions` visible and `#transactionTable` hidden. January + All gave the same empty state.
Wait pattern: `const r = page.waitForResponse(/\/transactions\/month\//); await go.click(); await r;`, then assert on the table or the empty state.
The details cells are filled by AJAX. Wait with `await expect(page.locator('#accountId')).toHaveText(id)`.

Descriptions observed: `Funds Transfer Sent`, `Funds Transfer Received`. Bill payments appear on the paying account **[UNVERIFIED]** (description text not captured).

### 2.5 Transaction Details — `transaction.htm?id={txid}`
Title `ParaBank | Transaction Details`. **Server-rendered** (no AJAX). It has no ids; it is a 2-column table: `Transaction ID:`, `Date:`, `Description:`, `Type:`, `Amount:`.
Locator: `page.locator('#rightPanel tr', { hasText: 'Amount:' }).locator('td').nth(1)`.

### 2.6 Transfer Funds — `transfer.htm`
Title `ParaBank | Transfer Funds`. H1 `Transfer Funds`.

| Element | Locator | Notes |
|---|---|---|
| Amount | `#amount` (`name="input"`) | n/a |
| From | `#fromAccountId` | **AJAX-populated**, ascending ids; first option preselected |
| To | `#toAccountId` | **AJAX-populated**; **defaults to the same account as From** |
| Transfer | `getByRole('button', { name: 'Transfer' })` | submit, prevented, then AJAX |
| Result | `#showResult` | h1 `Transfer Complete!`; `#amountResult` (`$25.00`), `#fromAccountIdResult`, `#toAccountIdResult` |
| Error | `#showError` | `An internal error has occurred and has been logged.` |

Success text (verified): `$25.00 has been transferred from account #22335 to account #22890.` and `See Account Activity for more details.`

**Validation behaviour (verified):** there is **no client-side validation**. The two `p#amount.errors` messages ("The amount cannot be empty." / "Please enter a valid amount.") exist in the DOM but are **never shown**.
| Input | Result |
|---|---|
| empty | 400 `Required parameter 'amount' is not present.`, then the generic **Error!** view |
| `abc` | 400 `Failed to convert 'amount'...`, then the generic **Error!** view |
| `-5` | **Success**: `-$5.00 has been transferred...` |
| `99999` (more than balance) | **Success**: overdraft allowed, and the balance goes negative |
| same from/to | **Success** |
| `12.345` | **[UNVERIFIED]** (rate-limited before this case ran) |

Wait: `await expect(page.locator('#fromAccountId option')).not.toHaveCount(0)` before you select. After the click, assert `#showResult` is visible, or wait for `/services_proxy\/bank\/transfer/`.

### 2.7 Bill Pay — `billpay.htm`
Title `ParaBank | Bill Pay`. After success the title is set by JS to `ParaBank | Bill Payment Complete`. H1 `Bill Payment Service`.

| Field | Locator | Notes |
|---|---|---|
| Payee Name | `[name="payee.name"]` | no id |
| Address | `[name="payee.address.street"]` | n/a |
| City | `[name="payee.address.city"]` | n/a |
| State | `[name="payee.address.state"]` | n/a |
| Zip Code | `[name="payee.address.zipCode"]` | n/a |
| Phone # | `[name="payee.phoneNumber"]` | **id is a random UUID per page load** (for example `92547425-...`), so never use the id |
| Account # | `[name="payee.accountNumber"]` | n/a |
| Verify Account # | `[name="verifyAccount"]` | n/a |
| Amount | `[name="amount"]` | n/a |
| From account | `select[name="fromAccountId"]` | **server-rendered** options; **order not stable** (the same user saw the default 23001 in one load and 22890 in another), so always `selectOption` explicitly |
| Send Payment | `getByRole('button', { name: 'Send Payment' })` | `input[type=button]` |

**Client-side validation (verified).** Spans are `span.error`, toggled with `display`:
| id | Text | Trigger |
|---|---|---|
| `#validationModel-name` | `Payee name is required.` | empty |
| `#validationModel-address` | `Address is required.` | empty |
| `#validationModel-city` | `City is required.` | empty |
| `#validationModel-state` | `State is required.` | empty |
| `#validationModel-zipCode` | `Zip Code is required.` | empty |
| `#validationModel-phoneNumber` | `Phone number is required.` | empty |
| `#validationModel-account-empty` | `Account number is required.` | empty |
| `#validationModel-account-invalid` | `Please enter a valid number.` | `abc` |
| `#validationModel-verifyAccount-empty` | `Account number is required.` | empty |
| `#validationModel-verifyAccount-invalid` | `Please enter a valid number.` | `abc` |
| `#validationModel-verifyAccount-mismatch` | `The account numbers do not match.` | 12345 vs 54321 |
| `#validationModel-amount-empty` | `The amount cannot be empty.` | empty (note the trailing space in the DOM; use `toHaveText` normalization or a regex) |
| `#validationModel-amount-invalid` | `Please enter a valid amount.` | `ten` |

The two "Account number is required." spans share text, so assert by **id**, not by text.
Negative amount `-3`: **accepted** (`$-3.00`).

**Success (verified):** `#billpayResult` visible, h1 `Bill Payment Complete`, text `Bill Payment to Electric Co in the amount of $15.50 from account 22890 was successful.` and `See Account Activity for more details.` Spans: `#payeeName`, `#billpayResult #amount` (`$15.50`), `#billpayResult #fromAccountId` (the id collides with the select's `name`, so scope it). Negative values format as `$-3.00` here and as `-$5.00` on transfer (inconsistent).
Wait: `page.waitForResponse(/services_proxy\/bank\/billpay/)`, or `expect(page.locator('#billpayResult')).toBeVisible()`.

### 2.8 Find Transactions — `findtrans.htm`
Title `ParaBank | Find Transactions` (unchanged on results). H1s: `Find Transactions` (form), `Transaction Results` (result), `Error!`.

| Element | Locator | Notes |
|---|---|---|
| Account | `#accountId` | **server-rendered**; order not ascending (observed 22335, 23001, 22890) |
| Transaction ID | `#transactionId` + `#findById` | error span `#transactionIdError` |
| Date | `#transactionDate` + `#findByDate` | format **MM-DD-YYYY**; error `#transactionDateError` |
| Date range | `#fromDate`, `#toDate` + `#findByDateRange` | error `#dateRangeError` |
| Amount | `#amount` + `#findByAmount` | error `#amountError` |
| Results container | `#resultContainer` | `#transactionTable`, body `#transactionBody` |
| Row link | `#transactionBody a` | href `/parabank/transaction.htm?id={id}` (absolute path here; relative on the activity page) |
| Error view | `#errorContainer` | n/a |

The error spans `#accountIdError` etc. are **always "visible"** (empty inline spans). Assert with `toHaveText('Invalid ...')`, not `toBeVisible()`.

**Verified outcomes**
| Case | Result |
|---|---|
| By id (exists) | results view, 1 row: `10-31-2026 | Funds Transfer Sent | $100.00 |` |
| By id (999999999) | XHR 404; **results view with 0 rows** (no "not found" message) |
| By id `abc` | form stays; `#transactionIdError` = `Invalid transaction ID` |
| By date `10-31-2026` | all rows for that day |
| Date `2026-10-31` | `#transactionDateError` = `Invalid date format` |
| Date with no tx | results view, 0 rows |
| Range `10-01-2026`–`12-31-2026` | rows |
| Range `10/01/2026` | `#dateRangeError` = `Invalid date format` |
| Amount `100` | rows with amount 100 only |
| Amount `x1` or empty | `#amountError` = `Invalid amount` |

Notes:
- **Find by ID ignores the selected account** (`GET transactions/{id}`) **[FROM SOURCE + verified URL]**.
- Client validation is regex-only (`^\d{2}-\d{2}-\d{4}$`), so `13-45-2026` passes the client check **[UNVERIFIED]** server behaviour.
- Results replace the form. To search again, reload `findtrans.htm`.

### 2.9 Update Contact Info — `updateprofile.htm`
Title `ParaBank | Update Profile` (unchanged after success). H1 `Update Profile`.

| Field | Locator | Empty error (id / text) |
|---|---|---|
| First Name | `[id="customer.firstName"]` | `#firstName-error` `First name is required.` |
| Last Name | `[id="customer.lastName"]` | `#lastName-error` `Last name is required.` |
| Address | `[id="customer.address.street"]` | `#street-error` `Address is required.` |
| City | `[id="customer.address.city"]` | `#city-error` `City is required.` |
| State | `[id="customer.address.state"]` | `#state-error` `State is required.` |
| Zip Code | `[id="customer.address.zipCode"]` | `#zipCode-error` `Zip Code is required.` |
| Phone # | `[id="customer.phoneNumber"]` | not required |
| Update Profile | `getByRole('button', { name: 'Update Profile' })` | n/a |
| Result | `#updateProfileResult` | h1 `Profile Updated`, `Your updated address and phone number have been added to the system.` |
| Error | `#updateProfileError` | n/a |

- **AJAX pre-fill:** `GET customers/{cid}` fills the inputs **after** load (they are empty at DOMContentLoaded). If you `fill()` before it returns, the XHR **overwrites your input**. Wait with `await expect(page.locator('[id="customer.firstName"]')).not.toHaveValue('')`.
- Verified: an update of city and phone persisted after reload.
- Security note: the inline script embeds the user's **plaintext username and password** in the update URL.
- **[FROM SOURCE]** The success branch runs in the jQuery `error` callback when `status == 200`. This is intentional app quirkiness; do not "fix" waits around it.

### 2.10 Request Loan — `requestloan.htm`
Title `ParaBank | Loan Request`. H1 `Apply for a Loan`.

| Element | Locator | Notes |
|---|---|---|
| Loan Amount | `#amount` | n/a |
| Down Payment | `#downPayment` | n/a |
| From account | `#fromAccountId` | **server-rendered** |
| Apply Now | `getByRole('button', { name: 'Apply Now' })` | n/a |
| Result | `#requestLoanResult` | h1 `Loan Request Processed` |
| Provider | `#loanProviderName` | `Wealth Securities Dynamic Loans (WSDL)` |
| Date | `#responseDate` | `10-31-2026` (**format `MM-D-YYYY`: the day is NOT zero-padded [FROM SOURCE]**) |
| Status | `#loanStatus` | `Approved` / `Denied` |
| Approved block | `#loanRequestApproved` | `Congratulations, your loan has been approved.`; `#newAccountId` (href `/parabank/activity.htm?id={id}`) |
| Denied block | `#loanRequestDenied p.error` | reason text, see below |
| Error | `#requestLoanError` | generic |

**Verified outcomes** (admin processor at its observed defaults):
| Case | Status | Message |
|---|---|---|
| amount 1000, down 100, from an account with a large balance | Approved | `Congratulations, your loan has been approved.` plus new account id |
| amount 1000, down 5000, from an account with a negative balance | Denied | `You do not have sufficient funds for the given down payment.` |
| amount 100000000, down 10, rich account | Denied | `We cannot grant a loan in that amount with your available funds.` |
| empty fields | n/a | 400, generic **Error!** view |
| amount `abc` | n/a | 400, generic **Error!** view |

**[FROM SOURCE]** Two more denial texts exist: `We cannot grant a loan in that amount with your available funds and down payment.` and `We cannot grant a loan in that amount with the given down payment.` (depend on the processor mode).
On denial, `#newAccountId` still exists (hidden) with href `.../activity.htm?id=null`.
**Gotcha:** approval depends on the admin settings of the **shared** instance (loan provider, processor, threshold). Anyone can change them, so keep approved/denied cases far from the thresholds. Example: approved = amount 100, down 10 from a fresh $515.50 account **[UNVERIFIED for fresh account]**; denied = down payment > balance.

### 2.11 Log Out — `logout.htm`
Click `#leftPanel getByRole('link', { name: 'Log Out' })`. It redirects to `index.htm` (title `ParaBank | Welcome | Online Banking`) and the login panel returns (verified). Afterwards, protected pages behave as in §2.1.

---

## 3. Recommended wait recipes (verified to work)
```ts
// account dropdowns populated by AJAX (openaccount, transfer)
await expect(page.locator('#fromAccountId option')).not.toHaveCount(0);
// overview table
await expect(page.locator('#accountTable tbody tr a').first()).toBeVisible();
// profile prefill
await expect(page.locator('[id="customer.firstName"]')).not.toHaveValue('');
// AJAX action result
const resp = page.waitForResponse(r => r.url().includes('/services_proxy/bank/transfer'));
await page.getByRole('button', { name: 'Transfer' }).click();
expect((await resp).status()).toBe(200);
await expect(page.getByRole('heading', { name: 'Transfer Complete!' })).toBeVisible();
```

## 4. Test-data guidance
- Unique username **and unique SSN** per user (lookup breaks on shared SSNs). Phone is optional on register.
- New user = 1 CHECKING account, $515.50. Each opened account moves $100 from the source.
- Transfers allow negatives, overdrafts and same-account transfers. Do not write "should reject" tests for them unless they are intentional bug documentation.
- Server-rendered dropdowns (bill pay, find transactions, request loan) have unstable order. Select by value; never rely on the default.
- Dates show in the **browser's local timezone** from a UTC-midnight timestamp (`1793404800000` = `2026-10-31T00:00:00Z`). In IST the result is correct (`10-31-2026`). **[UNVERIFIED]** but implied by the source: a UTC-negative timezone (US runners) would display **the previous day**. Pin `timezoneId: 'UTC'` in the Playwright config.

## 5. Unverified / not covered
- Transfer with 3-decimal amount (`12.345`).
- Contact email format validation.
- Server-side behaviour of a regex-valid but impossible date (`13-45-2026`).
- Whether the instance spontaneously DB-resets during runs (not observed in about 15 minutes).
- Viewing another customer's `activity.htm?id=` (authorization) was not tested.
- Admin page actions were deliberately not exercised.
