# Phase 3 Evidence Report: ParaBank Playwright framework

Date: 2026-10-31 (IST). Verifier: independent QA pass (EvidenceQA).
Target: public site `https://parabank.parasoft.com/parabank/`, defaults (no `.env`), 1 worker, Node 21.6.2, Playwright 1.64.1, chromium.
Builder claim under test: "51/51 tests pass live (1 worker, about 8.3 min)".

## 1. Commands executed

| # | Command | Purpose |
|---|---|---|
| 1 | `npx playwright test --list` | 51 tests in 13 files (confirmed) |
| 2 | `PLAYWRIGHT_JSON_OUTPUT_NAME=results/evidence-run-1.json npx playwright test --reporter=list,json` | Full suite, once |
| 3 | `PLAYWRIGHT_JSON_OUTPUT_NAME=results/evidence-run-2-smoke.json npx playwright test --project=chromium --grep @smoke --reporter=list,json` | Smoke run (same as `npm run test:smoke`, plus the JSON reporter) |
| 4 | `npx playwright test tests/auth/forgot-login.spec.ts --project=chromium --grep "requires every lookup field"` | Mutation check (with `src/data/messages.ts` mutated) |
| 5 | `npx playwright test --config <scratchpad>/evidence/evidence.config.ts` | Throwaway spec (3 tests) that takes the evidence screenshots |
| 6 | `npm run typecheck`, `npx eslint .`, `npx prettier --check .` | Static checks (no network) |

That is 4 live Playwright invocations in total: 51 + 11 + 1 + 3 = 66 test executions. Each ran once, with no re-runs.

## 2. Run results

| Run | File | Total | Passed | Failed | Flaky | Skipped | Wall time | Exit |
|---|---|---|---|---|---|---|---|---|
| 1: full suite (chromium + a11y + perf) | `results/evidence-run-1.json` (log: `results/evidence-run-1.log`) | 51 | **51** | 0 | 0 | 0 | **8.2 min** (489.3 s) | 0 |
| 2: `@smoke` (chromium) | `results/evidence-run-2-smoke.json` (log: `results/evidence-run-2-smoke.log`) | 11 | **10** | **1** | 0 | 0 | 1.7 min (101.4 s) | 1 |

Run 1 confirms the builder's claim: 51/51 passed in 8.2 min, against a claimed 8.3 min. Retries were 0, so "flaky" cannot appear locally. Every pass was a first-attempt pass.

### Run 1 detail

Pacing: 9 of 51 tests waited 22-42 s in `rate-limit-paced` before they started, for example forgot-login 41.6 s, update-profile 33.5 s and billpay validation 32.0 s. About 4.5 of the 8.2 minutes is the framework's own throttling, not test work. No `RATE_LIMITED` or `registration-recovered` annotations appeared.

Durations of the slowest tests (the pacing wait is included): forgot-login recover 48.1 s, update-profile 38.7 s, find-by-id 36.3 s, login empty creds 36.0 s, find-tx validation 35.5 s, billpay empty 34.9 s, a11y keyboard 24.9 s, a11y authenticated 16.0 s. All other tests took 1.9-8.6 s.

Perf metrics from run 1. All were under budget.

| Metric | Value (ms) | Budget (ms) |
|---|---|---|
| index TTFB / DCL / load / LCP | 449 / 1343 / 1421 / 1364 | 1500 / 5000 / 5000 / 4000 |
| register DCL | 401 | 2000 |
| ready: overview / openaccount / transfer / findtrans | 976 / 790 / 752 / 490 | 3000 |
| login -> overview | 1772 | 5000 |
| REST GET accounts | 284 | 2000 |
| transfer submit -> result | 417 | 4000 |

A11y run 1: axe ran on 13 pages and found real violations on every page, which shows the scans are not empty. Examples are register (color-contrast 14, label 13, html-has-lang, image-alt, link-name) and services (color-contrast 56). Every violation was allowlisted, so there were 0 blocking violations, 0 stale entries and 0 drift annotations.

### Run 2 failure (the only failure observed)

- **Test**: `tests/profile/update-profile.spec.ts:7` "updates address and phone, persisted server-side" `@smoke @regression` (0.8 s)
- **Error excerpt**:
  ```
  RegistrationError: Registering "pwmvw7ehpzins" over HTTP failed: HTTP 403
     at ..\src\fixtures\registration.ts:87
     at src\fixtures\test.ts:183:23 (user fixture)
  ```
- **Root cause, taken from the retained trace** (`test-results/profile-update-profile-Upd-32b3c-phone-persisted-server-side-chromium/trace.zip`, `0-trace.network`):
  ```
  GET  /parabank/register.htm 200  Server=cloudflare
  POST /parabank/register.htm 403  Cf-Mitigated=challenge; Server=cloudflare; CF-RAY=a531a8b07f793b1f-BOM
  ```
  Cloudflare issued a **managed challenge** (HTTP 403, `Cf-Mitigated: challenge`) on the registration POST in fixture setup. This was not a 429. It happened about 10 minutes into continuous traffic from this IP (run 1 plus run 2). The application under test never ran. This is an infrastructure or bot-protection failure, not a product defect and not an assertion defect.
- **Framework gap this exposes**: `src/support/rate-limit.ts:105` `isRateLimited()` recognises only 429 and "Error 1015". A Cloudflare 403 challenge is therefore not classified as `RATE_LIMITED`. It surfaces as a generic `RegistrationError ... HTTP 403`, which is the "misleading failure" the README says the guard prevents. **Severity: Medium.** It was observed once, cost 1 of 62 suite executions, and gave the wrong failure category.
- Stability conclusion: 61/62 = 98.4% across the two suite runs. The full suite passed once. A suite-level pass rate cannot be claimed from n=1. Because a 403 challenge appeared in the second run, back-to-back runs on the public site are not reliably green.

## 3. Assertion audit: do the tests assert what their titles say?

I read all 13 spec files in full, plus the fixtures and the page objects they rely on: `TransferPage`, `BillPayPage`, `FindTransactionsPage`, `UpdateProfilePage`, `RequestLoanPage`, `registration.ts`, `a11y.ts` and `perf.ts`.

Search for escape hatches: `grep test.skip|test.fixme|.skip(|test.fail|catch` over `src/` and `tests/` found **0** `skip`, `fixme` or `fail` calls. There are 3 `catch` blocks, and none of them swallows a test-relevant failure:
- `src/fixtures/test.ts:81` swallows `ApiError` only inside an `expect.poll(...).toBeGreaterThan(0)`. The poll still fails hard after 10 s.
- `src/api/ParaBankApiClient.ts:177` rethrows as `ApiError`.
- `src/utils/perf.ts:47` sets LCP to `null` when the PerformanceObserver is unsupported. The LCP budget is then silently not asserted (`tests/perf/perf.spec.ts:14`), but run 1 did record an LCP, so this did not trigger.

### Verified as meaningful (sample)

| Test | Evidence of real assertions |
|---|---|
| `transfer/transfer.spec.ts:7` | UI text names the amount and both accounts. API balances are checked in cents, before and after, on **both** accounts (`:32-33`). An API transaction lookup shows a `Credit` / `Funds Transfer Received` (`:35`). Reproduced independently: screenshot 01 shows -1465 and +1465 cents. |
| `transfer/transfer.spec.ts:44` (negative) | HTTP 400, the generic error text, the result hidden, **and** the source balance unchanged via the API (`:55-58`). |
| `auth/login.spec.ts:30,58,72` (negative) | Exact error text (`toHaveText`), URL, title, HTTP 500 for anonymous access. |
| `auth/register.spec.ts:5` | UI title, heading and welcome text, then the API confirms the customer fields and exactly 1 CHECKING account. |
| `billpay/billpay.spec.ts:24` | UI confirmation text, API balance minus exactly the amount, API debit transaction. |
| `billpay/billpay.spec.ts:98` | Exact validation text per field, a hard `visibleValidation` count, the result hidden. |
| `loan/request-loan.spec.ts:12,60` | Approved: status, provider, date matched against the response body, LOAN account via the API (screenshot 03). Denied: exact denial text, HTTP 200, no new account via the API. |
| `accounts/overview-activity.spec.ts:9` | Every row matches the API balance and available balance in cents, and the total matches the sum. |
| `accounts/open-account.spec.ts:14` | API type, owner and opening balance > 0, and the source debited by exactly the opening balance. |
| `profile/update-profile.spec.ts:7` | API persistence, reloaded-form values and login still working. |
| `a11y/a11y.spec.ts:25,47` | Hard (or soft, which still fails) `expect(blocking).toEqual([])`. The attachments show axe found 4-6 real rule violations per page, so the scans are not empty. |
| `a11y/a11y.spec.ts:85` | Tab order across 11 fields plus the submit button, and a check that the focus outline is not `none`. |

### Weak spots and vacuous-pass risks (file:line)

No test was found that can pass with **no** assertion. Every finding below is a weakening, not a fully vacuous test.

1. **Soft-only functional tests.** `tests/auth/forgot-login.spec.ts:34-41` ("requires every lookup field") and `tests/public/public-pages.spec.ts:79-89` ("customer care requires every field") contain **only** `expect.soft` assertions. Soft failures still fail the test: the mutation in section 4 proves this for the lookup test. So the tests are not vacuous. However, neither test asserts a total error count, unlike register (`register.spec.ts:214`) and billpay (`billpay.spec.ts:282`). An extra or unexpected error message would pass unnoticed. Severity: Low.
2. **Site Map step is soft-only**: `tests/public/public-pages.spec.ts:27-34`. It still fails the test, as in item 1. Low.
3. **A11y gate sensitivity is narrow by design**: `src/data/a11y-allowlist.json` allowlists, per page, every rule that currently fires (`label` on 11/13 pages, `color-contrast`/`html-has-lang`/`image-alt`/`link-name` globally). In `src/utils/a11y.ts:73` only a **new rule id** blocks. A regression that adds unlabelled inputs, or doubles the contrast failures on an already-allowlisted rule, only adds an `a11y-drift` annotation and never fails. The tests therefore prove "no new kind of violation", not "no new violations". The README states this, so it is not hidden. Severity: Medium (product-risk acceptance).
4. **Perf tests can never fail on timing**: `tests/perf/perf.spec.ts:11-14,54,70,73,83`. Every budget uses `expect.soft`. Soft failures do fail the test, so these do gate. The real weakness is that the budgets are about 4-5x the measured max, for example 5000 ms for login against 1772 ms observed. The only hard functional assertion is at `:198`. Severity: Low (documented).
5. **"No request" assertions are point-in-time**: `billpay.spec.ts:283`, `update-profile.spec.ts:91` and `find-transactions.spec.ts:384` check a request list right after the UI assertions, with no settle wait. A late async request after the check would be missed. In practice the preceding `toHaveText`/`toBeVisible` waits and the client-side jQuery validation make this low risk. Severity: Low.
6. **Range and date search assert containment only**: `find-transactions.spec.ts:312` (range) uses `toContain`, so it would not detect extra or wrong rows. `:297` (by date) does compare with the full API list, which is good. Severity: Low.
7. **`updates`/`calls` listeners filter on substrings** (`'/customers/update/'`, `'/billpay?'`, `'/transactions'`). If the endpoint path changed, these "no request" assertions would pass vacuously. They match the real endpoints today, as `pay()` and `transfer()` wait on the same substrings in passing tests. Severity: Low.

## 4. Mutation sanity check

- Backup: `cp src/data/messages.ts <scratchpad>/messages.ts.orig`, sha256 `7415f1a1ff86a549e396d6fd2eb45b9f2360c8d2745fd9fef1d11bd685de928a`.
- Mutation: `src/data/messages.ts:44` `lookup.required.ssn` changed to `'MUTATED Social Security Number is required.'`. The diff showed only line 44 changed.
- I targeted the **soft-only** test on purpose (`forgot-login.spec.ts:34`), to settle whether soft-only tests can fail.
- Result: **FAILED as expected (mutant killed)**, exit 1, 10.8 s:
  ```
  Error: ssn
  expect(locator).toHaveText(expected) failed
  Locator:  locator('#lookupForm').locator('[id="ssn.errors"]')
  Expected: "MUTATED Social Security Number is required."
  Received: "Social Security Number is required."
  ```
- Restore: copied the backup back. `diff` reported no differences (`RESTORED-IDENTICAL`), and the sha256 after restore is `7415f1a1...de928a`, identical to the backup.

## 5. Screenshots (`docs/evidence/`)

Static images are blocked by the framework's `networkGuard`, so the broken image placeholders are expected. The yellow boxes are injected by the evidence spec: they print the API values fetched after the action, so UI and API state appear in one image.

| File | What it proves |
|---|---|
| `01-transfer-complete-with-api-balances.png` | "Transfer Complete!": "$14.65 has been transferred from account #47865 to account #47976." API: from 41550 -> 40085 (-1465), to 10000 -> 11465 (+1465) cents. |
| `02-login-invalid-credentials-error.png` | Error page "Error!": "The username and password could not be verified." for an unknown user. |
| `03-loan-approved-api-loan-account.png` | "Loan Request Processed", Status Approved, new account 48531. The API returns `{"id":48531,"customerId":37076,"type":"LOAN","balance":500}`. |
| `04-mutation-lookup-ssn-killed.png` | Failure screenshot of the mutated run: the page shows the real "Social Security Number is required." text, which the mutated expectation rejected. |

The throwaway spec and config are at `C:\Users\pc\AppData\Local\Temp\claude\e--GIT-AdvanceTestingFramework\46578c66-050d-4850-9d4a-ee5ab5d0cc16\scratchpad\evidence\` (`evidence.spec.ts`, `evidence.config.ts`). It reuses the framework's fixtures and page objects unmodified. All 3 tests passed (15.8 s).

## 6. Static checks (side finding)

- `npm run typecheck`: pass.
- `npx prettier --check .`: pass.
- `npx eslint .`: **FAIL, 16 errors**, all in `.github/scripts/junit-summary.mjs` (`no-undef` / `no-console` for `console` etc.). This file and `.github/workflows/ci.yml` / `nightly-public.yml` were **created at 14:54 IST, during my verification run**, presumably by a parallel builder agent. `npm run verify` (and so the CI `verify` step) will fail until the ESLint config gives that file Node globals or ignores it. Severity: Medium (CI blocker).

## 7. NOT verified (honest gaps)

- **Suite-level stability**: only 1 full run and 1 smoke run (by instruction). The flake rate is not established, and 98.4% is from n=62 test executions on one afternoon from one IP.
- **firefox / webkit** (`BROWSERS=...`): not run.
- **CI mode** (`CI=true`: retries=1, JUnit, longer timeouts): not run. `.github/workflows/*` not executed.
- **Docker / self-hosted mode** (`npm run parabank:up`, 4 workers, no pacing): not run. Docker was not tested. The README already marks this as unverified.
- **Behaviour under an actual 429 ban** (`RATE_LIMITED` path, `waitForBanOrFail`): no 429 occurred, so it was not exercised. The 403-challenge path was observed and is not handled (section 2).
- **`registration-recovered` path** (duplicate-POST recovery): not triggered in any run.
- **Mutation coverage**: 1 mutant only, on 1 test. The other message constants and page-object locators were not mutated.
- **Product-level a11y conformance**: the a11y tests verify the allowlist gate only. Screen-reader and manual WCAG testing were not done.
- **Perf numbers**: single samples from India (edge BOM). They are not representative of other regions or of CI runners.
- Interactive-element sweeps from the generic QA protocol (accordions, mobile hamburger menu, dark mode, responsive viewports) are **not applicable**. ParaBank has no such features and the framework's spec does not cover them, so they were not tested.

## 8. Verdict

- Builder claim "51/51 pass live, 1 worker, about 8.3 min": **CONFIRMED** for a single run (51/51, 8.2 min, 0 retries).
- Assertion quality: **Good**. Functional tests cross-check UI against API state in cents, and negative tests assert exact error text and unchanged balances. No vacuous tests were found. Seven weakening findings are listed in section 3, the most significant being the a11y gate's rule-id-only sensitivity.
- Production readiness on the public site: **NOT DETERMINED**. The smoke run right after the full run hit an unhandled Cloudflare 403 challenge (1 failure). `npm run verify` currently fails lint because of the newly added `.github/scripts/junit-summary.mjs`.
- Required fixes:
  1. Treat `403` with `Cf-Mitigated: challenge` as an infrastructure failure (`RATE_LIMITED` or `CF_CHALLENGE`) in `isRateLimited` and `registerViaHttp`.
  2. Fix the ESLint globals for `.github/scripts/*.mjs`.
  3. Optionally add total-count assertions to the lookup and contact required-field tests.
- Re-test required: YES, after fixes 1 and 2, with a smoke run after a cool-down.
