# ParaBank UI Test Framework (Playwright + TypeScript)

End-to-end, accessibility and performance-budget tests for
[ParaBank](https://parabank.parasoft.com/parabank/index.htm), built on `@playwright/test` 1.64.
Discovery notes that back every locator, message and timeout live in `docs/discovery/`.

## Quick start

```bash
npm ci
npx playwright install --with-deps chromium
cp .env.example .env            # optional; defaults target the public site
npm run test:smoke              # 11 critical journeys, ~1 min
npm test                        # everything: e2e + a11y + perf projects
npm run report                  # open the HTML report
```

Node: CI uses Node 22 (`.nvmrc`). The tooling also runs on Node 21.6 locally. That is why the
`.env` loader is a small built-in parser and not `--env-file-if-exists` (Node >= 22.9).

## npm scripts

| Script                           | What it does                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `test`                           | All projects (`unit`, `chromium` e2e, `a11y`, `perf`)                          |
| `test:smoke` / `test:regression` | e2e filtered by `@smoke` / `@regression` tag (chromium)                        |
| `test:a11y`                      | Accessibility project (axe + keyboard), gated by the allowlist                 |
| `test:perf`                      | Performance budgets, sequential, `expect.soft`                                 |
| `test:unit`                      | Network-free unit tests (Cloudflare classification, pacing state); no browser  |
| `test:headed` / `test:debug`     | Headed run / Playwright Inspector                                              |
| `test:list`                      | Lists tests without running them (cheap CI sanity check)                       |
| `report`                         | `playwright show-report`                                                       |
| `lint` / `lint:fix`              | ESLint flat config (typescript-eslint type-checked + eslint-plugin-playwright) |
| `format` / `format:check`        | Prettier                                                                       |
| `typecheck`                      | `tsc --noEmit`                                                                 |
| `verify`                         | typecheck + lint + format:check + test:list + test:unit (no network)           |
| `parabank:up` / `parabank:down`  | Start/stop the self-hosted Docker instance                                     |

CI should run `verify`, then `test`. JUnit is written to `results/junit.xml` when `CI=true`.
Upload `playwright-report/`, `test-results/` and `results/`.

## Architecture

```
playwright.config.ts        projects: unit, chromium (+firefox/webkit via BROWSERS), a11y, perf
src/
  config/env.ts             typed env (+ tiny .env loader), single source of truth
  support/rate-limit.ts     Cloudflare classification (RATE_LIMITED / CF_CHALLENGE / CF_BLOCK),
                            leaky-bucket pacing, ban clock + cool-down persisted in .cache/
  api/
    ParaBankApiClient.ts    typed REST client (/services/bank, JSON), text-as-JSON, Cloudflare-aware
    types.ts                verified response shapes
  pages/
    BasePage.ts             layout (header, left menu, login panel), goto + Cloudflare check, waits
    endpoints.ts            XHR endpoint patterns shared by happy-path waits and "no request" checks
    components/             HeaderNav, LoginPanel, AccountServicesMenu
    public/                 Home, Register, Lookup, Contact, About/Services/SiteMap/Admin
    account/                Overview, OpenAccount, Activity (+TransactionDetails), Transfer,
                            BillPay, FindTransactions, UpdateProfile, RequestLoan
  fixtures/
    test.ts                 `test`/`expect` with all fixtures (import from '@src/fixtures')
    registration.ts         HTTP form registration (GET then POST register.htm) and login
    accounts.ts             AccountsHelper: open/deposit/transfer/balance via API
  data/
    factories.ts            faker (seeded per test) + unique username/SSN
    messages.ts             UI texts, verified only
    a11y-allowlist.json     rule-level allowlist from docs/discovery/04
  utils/                    money (cents), dates (MM-dd-yyyy, UTC), a11y, perf
tests/                      grouped by feature: auth, accounts, transfer, billpay,
                            transactions, profile, loan, public, a11y, perf, unit
```

### Fixtures

| Fixture                          | Scope              | Purpose                                                                                                                                                                                  |
| -------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `networkGuard`                   | test, **auto**     | Re-seeds faker, blocks images/fonts/media, serves CSS/JS from a worker cache, paces at the test boundary, classifies Cloudflare answers, adds `requests` and `failure-class` annotations |
| `api`                            | worker             | `ParaBankApiClient` on an `APIRequestContext` with `Accept: application/json`                                                                                                            |
| `user`                           | test               | Fresh customer registered **over HTTP through the page's own context**, so the page is already logged in. Gives `customerId` and `primaryAccountId`                                      |
| `registeredUser`                 | test               | Same, but registered in a separate context, so the page stays anonymous (login and forgot-login tests)                                                                                   |
| `newUser`                        | test               | Unregistered factory data (UI registration and validation tests)                                                                                                                         |
| `sharedUser`                     | test (worker user) | One customer per worker, page logged in over HTTP. Only for validation-only, scan and perf tests that do not depend on exact balances or untouched profile data                          |
| `accounts`                       | test               | `AccountsHelper` bound to `user` for API seeding and balance cross-checks                                                                                                                |
| `homePage` ... `requestLoanPage` | test               | Page objects                                                                                                                                                                             |

Every test owns its data. No test depends on another test, on a seed user (`john/demo`), or on a
hard-coded id. There is no API to create or delete customers, so isolation comes from unique users,
not cleanup.

## Environment variables

| Var                                                | Default                                   | Notes                                                                                                       |
| -------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `BASE_URL`                                         | `https://parabank.parasoft.com/parabank/` | Any ParaBank root; the REST base is derived (`services/bank/`)                                              |
| `TEST_SEED`                                        | random, pinned per run                    | Recorded in each test's `seed` annotation; re-run with the same value to reproduce data                     |
| `WORKERS`                                          | 1 public / 4 self-hosted                  | Raising it on the public site trips Cloudflare                                                              |
| `RETRIES`                                          | 0 local / 1 CI                            | Retries measure flakiness. A pass-on-retry is a flake to fix                                                |
| `BROWSERS`                                         | `chromium`                                | e.g. `chromium,firefox,webkit` adds functional projects                                                     |
| `RATE_LIMIT_RPM`                                   | 60 public / 0 self-hosted                 | Average requests/min (leaky bucket at test boundaries + 60 s window ceiling)                                |
| `RATE_LIMIT_TEST_BUDGET`                           | 20                                        | Headroom each test waits for before starting (measured p90 test cost: about 16 requests)                    |
| `RATE_LIMIT_LONG_WINDOW_S` / `RATE_LIMIT_LONG_MAX` | 600 / 450 public, 0 self-hosted           | Cumulative cap. **Hypothesis, unverified** against Cloudflare's slower trips                                |
| `RATE_LIMIT_MAX_WAIT_S`                            | 60                                        | Longest Retry-After / challenge cool-down worth waiting out. Longer ones fail fast. 330 for unattended jobs |
| `CF_CHALLENGE_RETRY_DELAY_S`                       | 30                                        | A managed challenge on an HTTP call is replayed once after this delay                                       |
| `CF_CHALLENGE_COOLDOWN_S`                          | 120                                       | After a challenge/block survives the replay, no traffic for this long                                       |
| `RATE_LIMIT_STATE_FILE`                            | `.cache/rate-limit-<host>.json`           | Persisted pacing/ban state (survives worker restarts and back-to-back runs)                                 |
| `BLOCK_STATIC_ASSETS`                              | `true`                                    | Aborts image/font/media requests                                                                            |
| `CACHE_STATIC_ASSETS`                              | `true`                                    | Serves same-origin CSS/JS from a per-worker memory cache after the first fetch                              |
| `GLOBAL_TIMEOUT_MIN`                               | 20 local / 30 CI                          | Whole-run guard                                                                                             |
| `HEADED`                                           | `false`                                   | n/a                                                                                                         |
| `CI`                                               | n/a                                       | Enables CI timeouts, retries, `forbidOnly` and the JUnit reporter                                           |

Timeouts follow `docs/discovery/05` (action 10/15 s, navigation 20/30 s, expect 7/10 s, test 60/90 s,
local/CI). `timezoneId` is pinned to `UTC` because ParaBank renders UTC-midnight transaction dates
in the browser's local zone.

## Rate-limit guidance (public site)

The public instance sits behind Cloudflare, which answers in three ways. Each one has its own error
code and `failure-class` annotation, so it never shows up as a misleading locator timeout:

| Code           | Signal                                                        | Class | What the framework does                                                          |
| -------------- | ------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| `RATE_LIMITED` | 429 / `error code: 1015`, `Retry-After` about 180-300 s       | A     | Ban clock (persisted). Waited out within `RATE_LIMIT_MAX_WAIT_S`, else fail fast |
| `CF_CHALLENGE` | 403 with `cf-mitigated: challenge`, or a "Just a moment" page | B     | HTTP calls replay once after 30 s; then a 120 s cool-down (persisted)            |
| `CF_BLOCK`     | 403 "Attention Required! \| Cloudflare" / error 1020 (WAF)    | B     | Fail fast, cool-down                                                             |

Classification is header-first (`classifyCloudflare` in `src/support/rate-limit.ts`, unit-tested
offline). It runs in the API client, HTTP registration, `BasePage.goto` and the `networkGuard`
response listener. Only the 429 rows and the 403 `cf-mitigated: challenge` row have been observed on
this site. The other markers come from general Cloudflare behaviour.

- Default to `WORKERS=1` on the public site. Run big suites against Docker instead.
- **Pacing is a leaky bucket.** A test that sent `c` requests in `d` ms makes the next test wait
  `c * 60 s / RATE_LIMIT_RPM - d`. A 60 s window and a long window act as hard ceilings. Navigations
  are never throttled mid-flight.
- **State is persisted** to `.cache/rate-limit-<host>.json`, so a worker restarted after a failure,
  or a run started right after another, still knows about the ban, the cool-down and recent traffic.
- Every test is annotated with `requests` (`{"browser","api","total"}`). The pacing wait is a
  `[rate-limit] pace before test` step, and failures get `failure-class`: A `RATE_LIMITED`,
  B `CF_CHALLENGE`/`CF_BLOCK`, C `DB_RESET_SUSPECTED`, D `ASSERTION`, E `TEST_OR_FRAMEWORK`.
- Images, fonts and media are blocked, and CSS/JS are cached per worker.
- If you are banned or challenged, wait about 5 minutes. Re-running immediately extends it.

### Shared-instance hazards (observed live)

- **Anyone can reset the public database** (`admin.htm` Initialize/Clean are anonymous). Customer
  ids dropped from about 17 500 to about 14 000 during one afternoon. Canary: ids only grow, so a new
  customer id lower than one seen before (persisted) adds a `DB_RESET_SUSPECTED` annotation, which is
  not fatal for that fresh user. If a new customer's accounts never appear, the fixture re-probes the
  login. A login that still works means eventual consistency; a customer that is gone fails with
  `DB_RESET_SUSPECTED` (class C).
- Registration occasionally answers "This username already exists." for a unique username (the
  POST was delivered twice). `registerViaHttp` detects this, verifies the credentials and logs in,
  then adds a `registration-recovered` annotation.
- Loan approval depends on global admin settings. Tests use amounts far from any threshold.
- **Never** submit the Admin page or call `initializeDB`/`cleanDB`/`setParameter` against the
  shared host.

## Docker mode (self-hosted)

```bash
npm run parabank:up                                    # docker compose up -d + wait
BASE_URL=http://localhost:8080/parabank/ npm test      # 4 workers, no pacing by default
npm run parabank:down
```

Image: `parasoft/parabank:latest` (verified on Docker Hub; tags `latest`, `feature`, `baseline`).
The `/parabank` context path and start-up time were **not verified locally** because Docker was
unavailable on the authoring machine. Pin an image digest once validated.

## Conventions

- **Locators.** ParaBank has no `<label>` elements, so `getByLabel` never works. Use `[id="..."]`
  (ids contain dots, e.g. `customer.firstName`), `[name="..."]`, and `getByRole('button', { name })`.
  Never use the Bill Pay phone input id (a random UUID per load).
- **Waits.** No `waitForTimeout` (lint error). AJAX dropdowns, tables and pre-filled forms are awaited
  inside page objects (`waitUntilReady`). Actions wait on the XHR response plus the visible
  result/error container.
- **Setup through the API, assert through the UI.** Then cross-check state through the API in
  integer cents (`toCents`).
- **Tags.** Each functional test has `@smoke` and/or `@regression`. `@a11y`, `@perf` and `@unit` select
  their own projects. `@shared-db` (writes visible shared data: contact form) and `@admin-defaults`
  (outcome depends on global admin settings: loan, open account) let operators exclude them with
  `--grep-invert`.
- **Readability.** Use `test.step` for phases. Page-object actions are steps already.
- **Messages.** Only strings verified on the live site go in `src/data/messages.ts`.
- **A11y gate.** Tests fail only on critical/serious violations that are not allowlisted for that page.
  Stale allowlist entries and node-count drift are annotated, never failing.
- **Perf.** Budgets about 4-5x the measured max, `expect.soft`, metrics attached as JSON.

## CI/CD

Workflows live in `.github/workflows/`. Shared setup (Node from `.nvmrc`, `npm ci` with npm cache,
cached Playwright browser) is the local action `.github/actions/setup`. The job-summary table comes from
`.github/scripts/junit-summary.mjs` (no third-party action).

| Workflow             | Trigger                      | What it does                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`             | pull request, push to `main` | `verify` (typecheck, lint, format, `--list`; no network, no browsers), then `e2e-docker`: starts `parasoft/parabank` via compose, waits with `scripts/wait-for-parabank.mjs`, runs `@regression` on chromium in 3 shards with `WORKERS=2` each                                                                                               |
| `ci.yml` (merge)     | after `e2e-docker`           | `merge-reports` merges the per-shard blob reports into one HTML report plus `results/junit.xml` (artifact `playwright-report`) and writes a job summary                                                                                                                                                                                      |
| `nightly-public.yml` | 02:17 UTC daily, manual      | `@smoke` + `@a11y` only against the public site (about 3 min): `WORKERS=1`, `RATE_LIMIT_RPM=60`, `RATE_LIMIT_TEST_BUDGET=20`, `RATE_LIMIT_MAX_WAIT_S=330`, `RETRIES=0`. Full regression runs on the docker job. Concurrency group `nightly-public` (queues, never overlaps). Uploads HTML report, `test-results/`, JUnit, plus a job summary |

Notes:

- If ParaBank does not answer `http://localhost:8080/parabank/index.htm` within 240 s, the docker job
  fails with an error annotation, `docker compose ps/logs` and path probes. It never passes silently.
  The compose context path and start-up time are still unverified (see Docker mode).
- Every shard runs its own container, so shards do not share a database. Tests own their data.
- The Cloudflare ban is per IP and GitHub-hosted runner IPs are shared. A `RATE_LIMITED` or
  `CF_CHALLENGE` failure in the nightly run (see the `failure-class` annotation) is infrastructure. Wait
  about 5 minutes and re-dispatch; do not file it as a product bug.
- `verify` also runs the `unit` project: network-free and browser-free.
- Artifacts: `blob-report-N` (3 days), `failure-details-N` (7 days), `playwright-report` and
  `nightly-report-<run id>` (14 days).
