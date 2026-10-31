# 05 - ParaBank Performance Baseline

Measured 2026-10-31 from India (Cloudflare edge BOM), Playwright 1.64.1 / headless Chromium, fresh context per sample, n=4 sequential samples per page (n=1/2/4 contexts for concurrency). Small n: treat p50 as indicative and "max" as the only tail evidence. All times in ms.

## 1. CRITICAL FINDING: Cloudflare rate limiting

The public instance sits behind Cloudflare. After roughly 4 full user journeys in ~40 s (about 250 HTTP requests including static assets, from one IP, with no throttling), every request returned **HTTP 429 "Access denied"** with `retry-after: 184` (seconds). The block was still active 90 s after the first 429 and had cleared by our next poll (about 4-8 minutes after the first 429 was observed; roughly consistent with the 184 s `retry-after` plus polling granularity). Symptoms in a test: the page is a Cloudflare HTML page, so the first `fill()`/`click()` simply times out - a misleading failure.

Framework consequences:
- A full suite against the public site from one IP WILL get blocked. Budget requests, keep suites small, and prefer API shortcuts (see below).
- Add a guard that detects status 429 (and the title "Access denied") on any response and fails fast with a clear message (`RATE_LIMITED`), and does NOT retry in a tight loop. Honor `retry-after`.
- Block static assets (images, css, fonts) with `page.route` to cut request volume ~70% where visual fidelity is not under test.
- Support a configurable `BASE_URL` so the suite can run against a self-hosted ParaBank (Docker image `parasoft/parabank`) for real parallel/CI load; use the public site only for a small smoke subset.

## 2. Page navigation timings (n=4)

| Page | TTFB p50 / max | DOMContentLoaded p50 / max | load p50 / max | LCP p50 / max | Ready-state* p50 / max |
|---|---|---|---|---|---|
| index.htm (cold, anonymous) | 328 / 352 | 1169 / 1200 | 1441 / 1851 | 1460 / 1872 | 1459 / 1863 |
| register.htm | 258 / 267 | 348 / 375 | 387 / 447 | 408 / 476 | 397 / 481 |
| overview.htm | 267 / 275 | 297 / 301 | 300 / 305 | 320 / 332 | 357 / 399 (#accountTable) |
| openaccount.htm | 269 / 282 | 292 / 317 | 303 / 328 | 328 / 352 | 642 / 673 (dropdown options attached) |
| transfer.htm | 262 / 275 | 294 / 298 | 301 / 311 | 324 / 344 | 671 / 738 (#toAccountId options) |
| findtrans.htm | 262 / 275 | 280 / 298 | 286 / 306 | 308 / 332 | 344 / 375 (#accountId options) |

*Ready-state = wall time from `goto` start until the page-specific readiness selector exists. Account dropdowns are populated by an AJAX call after `load`; they add ~300-350 ms. Note `<option>` elements are never "visible" to Playwright: wait with `state: 'attached'` or use `expect(select.locator('option')).not.toHaveCount(0)`.

index.htm is the slowest (cold TLS/connection + first asset fetch, DCL ~1.2 s); later pages reuse the connection.

## 3. Action latencies (n=4)

| Action (click -> visible result) | p50 | max |
|---|---|---|
| Register submit -> "account was created" (auto-login) | 399 | 465 |
| Login submit -> #accountTable (overview) | 955 | 1071 (includes the post-login redirect and page load) |
| Open account submit -> "Account Opened" | 53 | 203 (AJAX, very fast; low confidence, n=4) |
| Transfer submit -> #showResult | 362 | 415 |
| REST `GET /services/bank/customers/{id}/accounts` (JSON, 200, 2 accounts) | 271 | 291 |

Useful API facts: `GET /parabank/services/bank/login/{user}/{pass}` with `Accept: application/json` returns the customer incl. `id`, enabling API-based setup and teardown-free data creation. Registration creates a brand-new customer each time; use unique usernames (timestamp + random).

## 4. Parallelism (each context = register + logout + login once)

Run after the rate-limit cooldown, 15 s pause between levels.

| Concurrent contexts | Errors | 429s | Wall total | Register latency (each) | Login latency (each) |
|---|---|---|---|---|---|
| 1 | 0 | 0 | 4.9 s | 529 | 878 |
| 2 | 0 | 0 | 5.1 s | 499, 496 | 1107, 1012 |
| 4 | 0 | 0 | 6.3 s | 566, 1314, 534, 462 | 1000, 1086, 853, 914 |

Latency is flat up to 4 contexts (one 1.3 s register outlier at 4). The server itself tolerates 4 parallel users; the limiting factor is the request-rate cap at Cloudflare, not server concurrency. Only small-scale tested on purpose.

## 5. Recommended framework settings

Rule of thumb: ~5-10x the p50 for actions, headroom for the demo host's occasional slowness and CI network latency.

| Setting | Local | CI | Basis |
|---|---|---|---|
| `use.actionTimeout` | 10 000 | 15 000 | slowest action 1.1 s |
| `use.navigationTimeout` | 20 000 | 30 000 | slowest load 1.9 s; allows cold start |
| `expect.timeout` | 7 000 | 10 000 | dropdown populate ~0.7 s, AJAX results < 0.5 s |
| `timeout` (per test) | 60 000 | 90 000 | register+login+2 actions ~ 5-8 s typical |
| `globalTimeout` | 20 min | 30 min | guards runaway suites |
| `retries` | 0 | 1 (never more; each retry costs a full register journey and rate-limit budget) |
| `workers` | 2 | 2 against public site (hard max 4); 4-6 only when `BASE_URL` points to self-hosted ParaBank |
| `fullyParallel` | true | true, but each test creates its own unique user (no shared state) |
| `trace` / `video` | `retain-on-failure` / off | `on-first-retry` / `retain-on-failure` |

Also: `retries: 0` locally so flakiness is visible; `reporter` html+list locally, html+junit in CI; 429 detection fixture as above.

## 6. Suggested lightweight performance budget assertions (soft)

Use `expect.soft` and log/annotate rather than fail the suite; these are ~4-5x the measured max.

| Budget | Soft threshold |
|---|---|
| TTFB any page | < 1500 |
| DOMContentLoaded (index) | < 5000; other pages < 2000 |
| load event any page | < 5000 |
| LCP any page | < 4000 (Google "good" is 2500; measured max 1872) |
| Account dropdown populated after load (open/transfer/findtrans) | < 3000 |
| Register / transfer / open-account action to result | < 4000 |
| Login to overview | < 5000 |
| REST accounts GET | < 2000 |

Implementation note: collect via `performance.getEntriesByType('navigation')[0]` and a buffered `PerformanceObserver({type:'largest-contentful-paint', buffered:true})` read after ~300 ms. Attach values as test annotations / `testInfo.attach` JSON so trends are visible without failing runs. Gate on budgets only in a dedicated, serial `@perf` project (workers 1).

## 7. Method notes / caveats
- Scripts (throwaway): `C:\Users\pc\AppData\Local\Temp\claude\e--GIT-AdvanceTestingFramework\46578c66-050d-4850-9d4a-ee5ab5d0cc16\scratchpad\perf\` (lib.js, run1.js, run2.js).
- Locators that worked: register fields `input[name="customer.*"]`, `repeatedPassword`, submit `input[value="Register"]`; login `input[name=username|password]`, `input[value="Log In"]`; `#accountTable`; open account `#type`, `#fromAccountId`, `input[value="Open New Account"]`, `#newAccountId`; transfer `#amount`, `#fromAccountId`, `#toAccountId`, `input[value="Transfer"]`, `#showResult`; find transactions `#accountId`.
- The two measurement phases were separated by a Cloudflare block; network conditions (and thus absolute numbers) may differ from your location/CI.
