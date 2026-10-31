# Phase 3b: Test Results Analysis (ParaBank Playwright framework)

Date: 2026-10-31. Analyst: Test Results Analyzer.
Method: offline only. Inputs were `results/evidence-run-1.json` and `-run-2-smoke.json` (plus `.log`), `docs/evidence/EVIDENCE-REPORT.md`, `docs/discovery/02..05`, and a full read of `src/`, `tests/`, `playwright.config.ts`. I ran `npx eslint .` and `npx playwright test --list` and one scratch-copy experiment on `junit-summary.mjs` (scratchpad only). No test was run against the live site and no project file was changed.

Evidence grading used below: **[measured]** = read straight from the JSON/log/source. **[inferred]** = derived arithmetic or reasoning. **[unverified]** = needs a live run (not allowed now) or general Cloudflare knowledge not observed in this project.

---

## 0. Headline findings

1. **Half of run 1 is the framework waiting for itself.** 250.1 s of 474.5 s summed test time (52.7%; 51.1% of the 489.3 s wall clock) is `rate-limit-paced` wait. Real work is 224.4 s (mean 4.4 s, median 4.0 s, p90 6.4 s, max 16.0 s). [measured]
2. **The pacing is a sawtooth, not a smooth rate.** Seven waits of 22.6-41.6 s account for 226.7 s (91%) of all pacing. They recur about every 60-70 s. Between them the suite runs unthrottled at an estimated 150-180 requests/min. [inferred]
3. **90 requests/min is not conservative.** The lowest documented 429 trip was an average of about 80 req/min over 6 min (doc 02). Run 1 survived 8.2 min at an average of up to 90 req/min exactly once (n=1). There is no margin evidence. [inferred]
4. **The 403 challenge is a different mechanism from the 429 ban and the framework cannot see it.** It appeared 9 min 44 s after the first request of run 1 (run 1 started 09:23:45Z, update-profile failed at about 09:33:29Z). It was a single-request challenge: the next three tests (which register users over HTTP) passed within 20 s. [measured]
5. **Playwright discards the worker after every failure, and the ban clock and pacing window live in worker memory** (`src/support/rate-limit.ts:29-31`). After a `RATE_LIMITED` or any failure, the next test starts with an empty window and no ban clock. Evidence: after the run-2 failure the remaining 3 tests ran on `workerIndex` 1. [measured; consequence inferred]
6. **`.github/scripts/junit-summary.mjs` is worse than a lint failure.** `\b` and `\d` inside a plain template literal become a backspace character and the letter `d`, so every attribute regex fails. The script prints `PASS` with all-zero counts while listing failed tests. I reproduced this with a sample JUnit file. [measured]
7. The evidence report has a few wrong numbers and line references (section 9). The assertion audit itself holds up.

---

## 1. Per-test duration analysis

### 1.1 Where the 489 s went (run 1, 51 tests, 1 worker)

| Component | Seconds | Share of wall (489.3 s) |
|---|---|---|
| Pacing waits (`rate-limit-paced` annotations, 20 tests) | 250.1 | 51.1% |
| Real work (test duration minus pacing) | 224.4 | 45.9% |
| Non-test overhead (worker start, reporter, teardown; wall minus summed durations) | 14.8 | 3.0% |

Method note: the JSON repeats annotations at both test level and result level, so naive summing double counts (500.1 s). The `rate-limit-paced` value is included in the test `duration` because the wait happens in the auto fixture `networkGuard` (`src/fixtures/test.ts:148`). Check: forgot-login "recovers credentials" = 48.1 s duration = 41.6 s paced + 1.4 s body step + about 5 s fixtures. `steps[]` does not show hook or fixture time and `stdout` is empty (0 entries in all 51 tests), so **pacing is only discoverable through annotations**. A person reading the HTML report sees "48 s test", with no step explaining why.

Pacing distribution (20 tests with any wait): 13 small waits of 0.17-4.0 s (23.4 s total) and 7 large waits of 22.6-41.6 s (226.7 s). The evidence report says "9 tests waited 22-42 s"; the JSON supports 7. The report's "about 4.5 of 8.2 minutes" should be 4.2 min.

### 1.2 Slowest tests (duration, with the pacing share split out)

| # | Test | Duration (s) | Paced (s) | Real (s) |
|---|---|---|---|---|
| 1 | auth/forgot-login: recovers credentials | 48.1 | 41.6 | 6.5 |
| 2 | profile/update-profile: updates address and phone | 38.7 | 33.5 | 5.2 |
| 3 | transactions: finds a transaction by id | 36.3 | 31.9 | 4.4 |
| 4 | auth/login: rejects empty credentials | 36.0 | 33.1 | 2.9 |
| 5 | transactions: validates input formats | 35.5 | 32.1 | 3.4 |
| 6 | billpay: flags every required field when empty | 34.9 | 32.0 | 3.0 |
| 7 | a11y: keyboard Tab order | 24.9 | 22.6 | 2.3 |
| 8 | a11y: authenticated pages (7 scans) | 16.0 | 0 | **16.0 (slowest real work)** |
| 9 | transfer: rejects non-numeric amount | 8.6 | 4.0 | 4.6 |
| 10 | accounts: opens CHECKING | 7.9 | 0 | 7.9 |
| 11 | auth/login: log in and log out | 7.8 | 0 | 7.8 |
| 12 | accounts: details, transactions, filters | 7.7 | 0 | 7.7 |

Reading: ranks 1-7 are slow only because they happened to be the test sitting at the sawtooth edge. A test "rejects empty credentials" that makes one page load is not intrinsically slow (2.9 s). Duration rankings from this suite are therefore **not a signal about the product or the tests**. The only genuinely heavy tests are a11y-authenticated (16.0 s, 7 page loads, 1 registration), CHECKING/log-in (7.8 s) and activity (7.7 s).

By file (duration / paced): transactions 95.6 / 72.2 s; a11y 62.5 / 22.6; login 55.5 / 33.6; forgot-login 54.6 / 41.6; billpay 52.4 / 32.7; profile 46.3 / 37.1; transfer 19.4 / 4.0; register 17.7 / 0.4; public 16.0 / 2.1; loan 15.7 / 3.9; perf 13.6 / 0; accounts 25.1 / 0.

Smoke run (run 2): 11 tests, 87.0 s summed, 40.7 s paced (46.8%), 101.4 s wall. One test ("register") took 44.3 s of which 40.7 s was pacing, 20.7 s into a brand-new process whose window held only the previous 4 smoke tests. Four smoke tests were enough to fill a 90 req/min window with a 30-request reservation. This shows the pacing cost is front-loaded and not about suite length.

### 1.3 Why the pacing looks like a sawtooth

`waitForHeadroom(30)` (test.ts:148, rate-limit.ts:83-96) blocks a test until `sent.length + 30 <= 90`, i.e. until the window holds 60 or fewer requests. Tests run back to back until the window passes 60, then the next test sleeps until the oldest entries age out of the 60 s window. Result: about 30 s of unthrottled work (about 90 requests, so about 180 req/min instantaneous), then about 33 s idle. Observed cycle: large waits start at T+26, 98, 159, 223, 285, 345, 443 s (spacing 61-98 s). The rolling 60 s average is bounded near 90, but the **burst density inside each cycle is about twice the nominal rate**. Cloudflare's documented trip in doc 05 was 250 requests in about 40 s (375 req/min) and doc 02's was an average of about 80 req/min, so the burst is inside the observed danger range in the sense of sitting roughly halfway to the fast trip.

Two more mechanical observations:

- Peak overshoot is not bounded by `RATE_LIMIT_RPM`. The test-start gate only guarantees room for `RATE_LIMIT_TEST_BUDGET` (30) requests; a test that sends 55 pushes the window to about `rpm - 30 + 55 = 115`. Per-test request counts are not recorded anywhere, so the true overshoot is **unmeasured**. [inferred]
- API-slot waits made mid-test (`acquireRequestSlot` in `rate-limit.ts:99-102`, called from `ParaBankApiClient.ts:186` and `registration.ts:23`) are not covered by the `setTimeout(+paced)` extension at test.ts:150. They can wait up to 60 s inside the 60 s (local) test timeout. They did not occur in run 1 because every test starts with 30 slots of headroom. [inferred]

### 1.4 Projected effect of the pacing parameters on total runtime

Model: `T = max(R + C, D * 60 / rpm)` where R + C = 224.4 + 14.8 = 239.2 s is the unthrottled floor and D is total counted requests. Run 1 is almost fully rate-bound, so `D ≈ 90 * 489 / 60 ≈ 735` counted requests (about 14 per test on average). Accuracy about +/-10% because the first 26 s ran unpaced. [inferred; D is not measured anywhere]

| `RATE_LIMIT_RPM` (budget 30) | Projected wall | Note |
|---|---|---|
| 0 (off) | 4.0 min | the floor; unsafe on the public site |
| 150 | 4.9 min | about 2x burst density; likely trips |
| 120 | 6.1 min | |
| **90 (current)** | **8.2 min (measured)** | |
| 75 | 9.8 min | |
| 60 | 12.3 min | longer continuous traffic: worse for the 10-min challenge |
| 45 | 16.3 min | |

`RATE_LIMIT_TEST_BUDGET`: this does not change the long-run average (the rpm bound does). It changes the shape and the overshoot: a larger budget means shorter bursts and more waits per cycle; a smaller one means longer bursts and a higher peak window. It is a safety knob, not a speed knob.

**The real lever is demand D, not rpm.** Lowering rpm to look safer lengthens the run, and the challenge appears to correlate with continuous time (about 10 min), so a slower run is *more* exposed. Demand levers, all [inferred], none measured:

| Lever | Estimated effect on D |
|---|---|
| Serve same-origin `.css` and `.js` from an in-process cache after the first fetch (images, fonts, media are already blocked). Each page load costs about 1 doc + 2 css + 1 js + AJAX. | about -35 to -45% of browser requests |
| Share one registered user per worker for validation-only tests (about 13 candidates, see fix P1-6b). Saves register GET + POST + login + accounts poll = 4 calls each. | about -50 requests, about -7% |
| Nightly on the public site runs `@smoke` only (11 tests, about 150 requests) | -80% for that job |

Scenario: D cut by 35% (about 478) at rpm 60 gives `478 * 60 / 60 = 8.0 min`, the same wall time as today with a 33% lower rate. At rpm 90 it gives 5.3 min.

### 1.5 Is `rate-limit.ts` calibrated against the observed thresholds?

Observed thresholds (from the docs plus this evidence):

| Source | Observation | Equivalent average rate |
|---|---|---|
| doc 02 section 0.4 | about 25 page loads, about 19 requests each (about 475 req), about 6 min, then 1015 | about 80 req/min, bursty |
| doc 03 G1 | about 50 requests in about 3 min, then 429 / 1015 / Retry-After 288 | about 17 req/min |
| doc 05 section 1 | about 250 requests in about 40 s, then 429 / Retry-After 184 | about 375 req/min |
| Run 1 (this evidence) | about 735 counted requests in 8.2 min, no 429 | up to 90 req/min [inferred] |
| Run 1 + 2 | 403 managed challenge after about 9.7 min of continuous traffic | rate not the trigger [inferred] |

Verdict on the algorithm:

1. **Right shape for the fast ban, wrong shape for the slow ones.** A 60 s sliding window handles the 375 req/min burst class. It cannot see doc 02's 6-minute cumulative trip or the 10-minute challenge, because nothing is remembered beyond 60 s.
2. **90 req/min sits at the lowest known trip rate (about 80) with no margin.** It passed once. I would not call it calibrated; I would call it unfalsified.
3. **Doc 03's "50 in 3 min" is not reproducible as a sliding rule.** Run 1 sent an estimated 150-200 API-path requests (about 34 user fixtures x 4 calls plus in-test calls), i.e. about 55-75 per 3 min, without a 429. The doc 03 number was probably measured on top of earlier traffic in the same window. Do not encode it as a limit. [inferred]
4. **State is lost on worker restart and between runs** (see headline 5). Run 2 started 21 s after run 1 ended with an empty window, so the two runs together behaved like one 9.7 min uninterrupted session that the limiter believed was two short ones.
5. **No cumulative budget** and **no burst cap** exist. Both are cheap once state is persisted to a file.

### 1.6 Recommended parameter values

Public site profile (set in `.env.example`, `nightly-public.yml`, README table):

| Parameter | Current | Recommended | Reasoning |
|---|---|---|---|
| `RATE_LIMIT_RPM` | 90 | **60** | 25% below the lowest observed trip (about 80). Pair with the demand cuts in 1.4 so wall time stays about 8 min. |
| `RATE_LIMIT_TEST_BUDGET` | 30 | **40** | Closer to the p90 request cost of a registered-user test (instrument first, P1-4), so the window peak stays at or below rpm. |
| `RATE_LIMIT_MAX_WAIT_S` | 60 | **60 local, 330 in nightly** | Observed Retry-After is 184-288 s. At 60, the first real ban makes every remaining test fail fast with RATE_LIMITED (a cascade of red tests). At 330 the nightly job waits out one ban. The fixture already extends the test timeout (test.ts:131). |
| new `RATE_LIMIT_LONG_WINDOW_S` / `RATE_LIMIT_LONG_MAX` | n/a | **600 / 450** | Persisted across processes. Caps cumulative traffic to 450 per 10 min (about 45 req/min sustained, 60 burst). Hypothesis: it keeps a run under the 10-min challenge mark. **[unverified]**: validate with one deliberate experiment after the cool-down. |
| new `CF_CHALLENGE_RETRY_DELAY_S` | n/a | **30**, retry **once** | In the only observation the next registration passed 9.7 s later. Cloudflare answered before the origin, so replaying the POST is safe. |
| `retries` (CI) | 1 | keep 1, but see P1-3 | A retry after a challenge/ban should fail fast, not re-send traffic. |
| `workers` | 1 | keep 1 | Doc 05 says the server tolerates 4 contexts; the Cloudflare budget is the limit. |

Structural recommendation (P2-1): replace the window gate with a **leaky-bucket debt** at the test boundary. After each test, record its real cost `c` (requests) and its duration `d`, and before the next test sleep `max(0, c * 60 / rpm - d)` seconds. Same average rate, no 30-40 s stalls, no 22-42 s test durations, no sawtooth burst.

---

## 2. Failure classification taxonomy

### 2.1 Classes and how the framework surfaces each today

| Class | Typical trigger | Surfaced today? | How it looks to a reader |
|---|---|---|---|
| **A. Rate-limit (infra)** | Cloudflare 429 / error 1015, `Retry-After` 180-300 s | **Yes, distinct** at four sites: `BasePage.assertNotRateLimited` (BasePage.ts:58-66), `ParaBankApiClient.text` (ParaBankApiClient.ts:194-203), `registration.guarded` (registration.ts:21-31), `networkGuard` response listener (test.ts:155-163). Error `RATE_LIMITED:` plus a `RATE_LIMITED` annotation. Never exercised live (0 occurrences in 62 executions) [measured]. | Clear message. Gap: if the 429 arrives on an XHR during a test body, the headline error is a locator timeout and `RATE_LIMITED` is thrown from fixture teardown (test.ts:165-168) as a secondary error. |
| **B. Bot challenge (infra)** | Cloudflare 403 with `Cf-Mitigated: challenge`, or "Just a moment" interstitial | **No.** `isRateLimited` (rate-limit.ts:105-109) only knows 429 and "1015". | Observed: `RegistrationError: Registering "..." over HTTP failed: HTTP 403` (registration.ts:62-63 or :87). Misclassified as a test/setup error. Also `loginViaHttp` returns `false` silently on a 403 (registration.ts:53) and the duplicate-username recovery then reports a generic reason. In the API client a 403 becomes `ApiError` with 200 chars of HTML. In the browser a 403 document just times out the next locator. |
| **C. Shared-DB reset / state drift** | Someone presses Initialize/Clean on admin.htm of the shared instance, or eventual consistency after registration | **Partly.** Only `resolveRegisteredUser` (test.ts:67-95) polls 10 s for accounts and words its message "may have been reset" (test.ts:~88). Not tied to any signal, not annotated, not distinguishable from the documented "Could not find customer" lag. | Poll assertion failure `expected > 0, received 0`. A reset *mid-test* looks like an `ApiError` 404/500 or an "Error!" view: indistinguishable from a product defect. Never observed. |
| **D. Product defect** | App behaves differently from the discovery baseline (text, status, balance) | Not labelled. Falls out as an `expect` mismatch. Good: assertions are specific (cents, exact text). | `Expected "..." Received "..."` |
| **E. Test/framework defect** | Locator drift, strict-mode violation, bad fixture logic, TypeScript error, timing bug | Not labelled. | Timeout on a locator, `strict mode violation`, `TypeError` |

The central gap: **A is surfaced, B is not, C is guessed, D and E are the residual and are not separated from B or C.** One run showed B reported as E.

### 2.2 `isRateLimited` and the error paths: review

Findings on `rate-limit.ts:105-109`:

1. All three call sites pass the body only when `status === 429` (`registration.ts:25`, `ParaBankApiClient.ts:194`, `BasePage.ts:60`). So the regex half of `isRateLimited` is **dead code**: it can only be reached when status is already 429. It does not catch the case its comment promises ("or its Error 1015 interstitial") when the status is not 429.
2. It ignores headers entirely: `Cf-Mitigated`, `Server`, `CF-RAY`, `Retry-After`.
3. It returns a boolean, so callers cannot tell rate-limit from challenge from block.
4. `parseRetryAfter` is fine (empty/NaN falls back to 300 s; past HTTP-date gives 0 which means "no ban", acceptable).
5. `networkGuard` ignores the second and later 429s (`|| rateLimited` at test.ts:156), so a longer `Retry-After` seen later in the same test is not recorded in the ban clock.
6. In `registerViaHttp`, `if (!get.ok()) throw RegistrationError(... HTTP 403)` (registration.ts:62-63) runs after `guarded()` already returned, so any non-429 Cloudflare status is reported as a registration problem.

### 2.3 Exact signals to detect (per variant)

All header names are lowercase in Playwright's `headers()`. "via Cloudflare" means `server: cloudflare` or a `cf-ray` header is present. Require it for 403 and 503 so a genuine ParaBank 403/503 is not mislabelled.

| Variant | Status | Headers | Body / title markers | Class | Source |
|---|---|---|---|---|---|
| **Rate limit 1015 (API)** | **429** | `retry-after: 184-288`, `server: cloudflare` | text/plain body `error code: 1015` | A | [measured] doc 03 |
| **Rate limit 1015 (page)** | **429** | `retry-after`, `server: cloudflare` | title `Access denied \| parabank.parasoft.com used Cloudflare to restrict access \| parabank.parasoft.com \| Cloudflare`; text `You are being rate limited` / `Error 1015` | A | [measured] doc 02 |
| **Managed challenge (HTTP client)** | **403** | **`cf-mitigated: challenge`**, `server: cloudflare`, `cf-ray` | HTML interstitial (title `Just a moment...`) | B | [measured] trace, evidence report section 2 |
| **"Just a moment" interstitial (browser)** | **403** (managed/JS challenge) or **503** (legacy "Checking your browser") | `cf-mitigated: challenge` (usually), `server: cloudflare` | title `Just a moment...`; text `Enable JavaScript and cookies to continue` or `Performing security verification`; markers `/cdn-cgi/challenge-platform/`, `window._cf_chl_opt`, `cf-chl-`, `#challenge-form`, iframe `challenges.cloudflare.com` (Turnstile). No `Retry-After`. | B | **[unverified]** (general Cloudflare behaviour, only the 403 + header was observed here) |
| **WAF / firewall block** | **403** | `server: cloudflare`, no `cf-mitigated: challenge` | title `Attention Required! \| Cloudflare`; `Sorry, you have been blocked`; `error code: 1020` (also 1006-1010) | B (kind `block`) | **[unverified]** |
| **Origin down behind Cloudflare** | **520-526** | `server: cloudflare` | title contains `52x` / "Web server is returning an unknown error" | infra, not A or B | **[unverified]** |
| **ParaBank's own error** | **500** (also API 400/404) | no `cf-*` mitigation | `An internal error has occurred and has been logged.` (Messages.generic.internalError) | D candidate | [measured] doc 02/03 |

Detection rules (single function, header-first, body second, only read the body for 429/403/503):

```ts
// src/support/rate-limit.ts  (replace isRateLimited's role; keep it as a thin wrapper if desired)
export type CloudflareVerdict = 'rate-limit' | 'challenge' | 'block' | null;

export function classifyCloudflare(
  status: number,
  headers: Record<string, string>,
  bodyOrTitle = '',
): CloudflareVerdict {
  const viaCloudflare = /cloudflare/i.test(headers['server'] ?? '') || !!headers['cf-ray'];
  if (status === 429 || /error code: 1015|Error 1015|You are being rate limited/i.test(bodyOrTitle)) {
    return 'rate-limit';
  }
  if (!viaCloudflare) return null;
  if ((headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return 'challenge';
  if (
    [403, 503].includes(status) &&
    /Just a moment|Enable JavaScript and cookies to continue|\/cdn-cgi\/challenge-platform|_cf_chl_opt|cf-chl-|challenges\.cloudflare\.com/i.test(bodyOrTitle)
  ) {
    return 'challenge';
  }
  if (status === 403 && /Attention Required! \| Cloudflare|Sorry, you have been blocked|error code: 10(0[5-9]|1\d|20)\b/i.test(bodyOrTitle)) {
    return 'block';
  }
  return null;
}
```

Browser path additions: in `BasePage.assertNotRateLimited` read `await page.title()` and the first 2 KB of `await response.text()` only when status is 403/429/503 (never on 200/500 pages). The same check must also run on `context.on('response')` for `resourceType === 'document'` and `xhr/fetch` with status 403/429/503.

### 2.4 How to tell C (DB reset) from eventual consistency, and from D

- **Monotonic id canary (cheap, zero extra requests).** Keep `lastCustomerId` at module scope (and in the shared state file from P0-3). ParaBank customer ids only grow. If a freshly registered `customer.id` is lower than a customer id seen earlier, annotate `DB_RESET_SUSPECTED`. [inferred]
- **Re-probe before blaming.** When `resolveRegisteredUser`'s poll fails, call `api.login(username, password)` once more. Success means eventual consistency (test timing); a 404/"Could not find customer" for a user that *did* log in earlier in the same test means a reset (class C). This costs 1 request only on the failure path.
- **Admin canary (optional, expensive).** `admin.htm` still loads after a reset, so it cannot distinguish. Do not add.

### 2.5 Triage rule for a failed test (proposed `failure-class` annotation)

1. Error is `RateLimitedError` or has a `RATE_LIMITED` annotation: **A**.
2. Error is `CloudflareBlockedError` (new) or the HTTP/doc response matched `challenge`/`block`: **B**.
3. Annotation `DB_RESET_SUSPECTED`, or failed `resolveRegisteredUser` poll plus failed re-probe: **C**.
4. Error is an `expect` mismatch (`toHaveText`, `toBe`, `toEqual`) with no A/B/C evidence in the same test and a 2xx/4xx app response: **D**.
5. Everything else (locator timeout without infra evidence, strict-mode violation, `TypeError`, fixture exceptions): **E**.

Playwright's JUnit reporter writes annotations as `<properties>`, so the class can flow into `junit-summary.mjs` for a per-class table.

---

## 3. Flakiness risk assessment per spec file

Risk scale: **High** = likely to fail in normal use. **Medium** = fails when a known shared/external condition changes. **Low** = theoretical. "Observed" = seen in the evidence runs (none were).

Structural facts that apply to all files:

- Every functional test registers its own user; there is no cross-test data dependency and no `describe.serial`. [measured]
- Order dependence: none. Tests pass in file order with 1 worker; `fullyParallel: true` is safe because users are unique (username `pw` + base36 time + 3 random base36 chars; SSN random 9 digits). [measured]
- Shared global state exists in three places: admin settings (loan provider/processor/threshold, initial and minimum balance), the shared customer DB (lookup by SSN), and Cloudflare per-IP budget.
- `timezoneId: 'UTC'` is pinned (playwright.config.ts) and dates use the server's transaction date, so the midnight-UTC risk is handled except for the single month-boundary case in activity.

| Spec file | Risk | Main reasons (file:line) |
|---|---|---|
| `tests/auth/forgot-login.spec.ts` | **Medium** | `:9-18` lookup needs exact name+address+SSN uniqueness on a shared DB (doc 02: shared SSN breaks lookup); collision odds are low (random 9-digit) but not zero. `:34-41` soft-only assertions with no total error count (cannot detect extra errors). |
| `tests/auth/login.spec.ts` | **Low** | `:77-80` asserts HTTP 500 for anonymous `overview.htm`: a documented app quirk; if ParaBank starts redirecting this fails (correctly, but as a "test defect" until reviewed). Only 1 of 9 protected pages is checked. |
| `tests/auth/register.spec.ts` | **Low** | `:33` exactly 1 CHECKING account (depends on admin default). `:69`, `:83` exact error counts. The one UI registration test is the most Cloudflare-exposed single test. |
| `tests/accounts/open-account.spec.ts` | **Low-Medium** | `:36` `opening > 0` depends on the global `minimumBalance`; `:37` exact source debit assumes no other writer on this customer (true here). |
| `tests/accounts/overview-activity.spec.ts` | **Low-Medium** | `:20,:28` sorted id lists use default string sort on both sides (consistent, fine). `:23-26` assumes available = max(0, balance). `:54,:78` month filter name derived from UTC date: wrong only if the server filters in another timezone near a month boundary. `:70` `hasText` on a money string: safe because cents are 10.01-99.99 and the opening deposit is 100.00. |
| `tests/transfer/transfer.spec.ts` | **Low** | `:55` relies on the "no client validation, server 400" quirk. `:36-39` description text `Funds Transfer Received`. |
| `tests/billpay/billpay.spec.ts` | **Low-Medium** | `:59,:80` point-in-time "no request" check; predicate `'/billpay?'` substring (vacuous if the endpoint shape changes; works today because the happy path waits on the same substring). `:76-77` soft per-field checks plus `:79` exact count: good. `:84-96` unstable select order is handled by explicit `fromAccountId`. |
| `tests/loan/request-loan.spec.ts` | **Medium** | Outcome depends on global admin loan provider/processor/threshold (comment `:6-10` admits it). The denial message text differs by processor mode. Amounts are far from thresholds, which helps. Another user flipping the admin form on the public site breaks 3 tests at once. |
| `tests/profile/update-profile.spec.ts` | **Medium** | `:64,:91` point-in-time "no update request". `:17-22` pre-fill compared after an AJAX overwrite (guarded by `waitUntilReady` not-empty first name). Success branch runs in a jQuery *error* callback (quirk). Was the test that took the 403, but that is class B, not flake. |
| `tests/transactions/find-transactions.spec.ts` | **Medium** | `:116,:153` point-in-time `'/transactions'` substring check (the substring also matches seeding calls if ever routed through the page). `:94` exact `[id]` list is safe only while a fresh SAVINGS account has no other $x amount. `:62-66` containment then equality against the API: OK. `:81` range uses containment only. Midnight-UTC rollover between `seedCredit` and the search is covered by using the server date. |
| `tests/public/public-pages.spec.ts` | **Medium** | `:38-40` asserts third-party hrefs (`parasoft.com/.../products`, `/contacts`): external drift. `:50-57` exact option list of the admin loan provider. `:61-76` posts a fixed name and message to the shared DB each run (side effect; no assertion on the stored message). `:26-31` and `:83-85` soft-only. |
| `tests/a11y/a11y.spec.ts` | **Low-Medium** | Gate blocks only new rule ids (by design). Blocking images/fonts/media can change `color-contrast` and `image-alt` node sets (allowlist is by rule, so safe). `:85-113` keyboard order and outline are viewport/browser sensitive. `:47-83` one user for 7 pages, soft asserts: fine. Long (16 s) test uses its whole 60 s timeout budget only if pacing hits it. |
| `tests/perf/perf.spec.ts` | **Medium-High for timing, Low for logic** | Timing budgets are network dependent. `:72` times `api.getAccounts()` which internally runs `waitForBanOrFail` and `acquireRequestSlot` (ParaBankApiClient.ts:185-186): a throttle wait is counted as REST latency. It runs last, after 8 min of sustained traffic when Cloudflare is most likely to be slow or challenging. All budgets are 4-5x the observed max, so false failures are unlikely but a challenged run would fail them for the wrong reason. |

Cross-cutting risks (all files):

- **Point-in-time "no request sent" checks** (3 places: billpay.spec.ts:59/:80, update-profile.spec.ts:64/:91, find-transactions.spec.ts:116/:153). They run immediately after UI assertions. The preceding `toBeVisible`/`toHaveText` waits make a late request unlikely, but there is no positive control proving the predicate can ever match in that test.
- **Order-dependent list assertions**: none found that depend on server order. `overview-activity.spec.ts:20` and `:28` compare id lists order-insensitively after sorting; `find-transactions.spec.ts:62,:66,:94` compare by id. The default `Array.sort()` is lexicographic on numbers but is applied to both sides, so it cannot produce a false failure.
- **Retries on the public site** (CI `retries: 1`): a retried test re-registers (4 requests) and goes into a possibly banned state; with the worker restart a retry also has an empty pacing window.

---

## 4. Quality metrics

### 4.1 Coverage against `docs/discovery/02-ui-map.md`

**Page level.** The map has 19 page sections. 18 are exercised (95%). Untested: `news.htm` (map 1.9; static page with relative dates). Partly tested: section 2.1 logged-out access covers 1 of 9 protected pages.

**Validation and behaviour level** (counts from the map's tables):

| Area | Documented | Tested | Untested / gaps |
|---|---|---|---|
| Register required fields | 10 required + duplicate + mismatch = 12 | 12/12 (plus phone optional) | SSN format, password policy (map says not validated) |
| Login | 4 outcomes (valid, wrong pw, unknown, empty) | 4/4 | |
| Forgot login | success, not found, required | 3/3 | shared-SSN gotcha is not tested (inferred cause, unverified) |
| Contact | required (4), success | 5/5 | email format (map: UNVERIFIED) |
| Admin | read-only fields | read-only check | actions deliberately excluded (correct) |
| Overview | rows, total, footnote | yes | |
| Open account | CHECKING, SAVINGS | 2/2 | insufficient-funds behaviour (overdraft allowed, no test) |
| Activity | details, month+type filters, empty state, tx link | yes | other month/type combinations, `#error` view |
| Transaction details | 5 fields | 4 fields (ID, Type, Amount, Date) | Description field not asserted |
| Transfer | success, empty (400), `abc` (400) | 3/3 | negative amount accepted, overdraft accepted, same-account accepted, `12.345` (UNVERIFIED) |
| Bill pay | 13 client validation spans + success | 13/13 + success | negative amount accepted (`$-3.00`), payment visible in payer's activity (map: UNVERIFIED), result spans |
| Find transactions | by id, date, range, amount, 4 client errors, empty result | all 4 searches + 4 client errors + empty date | by id that does not exist (map: 404 then 0 rows), empty amount, impossible date `13-45-2026` (UNVERIFIED), id search ignoring the account selector |
| Update profile | 6 required, success, persist | all | phone optional/empty, `#updateProfileError` view |
| Request loan | approved, 2 verified denials, 2 FROM SOURCE denials, 2 x 400 | approved + 2 denials | empty/`abc` fields (400 error view), the two source-only denial texts |
| Logout | redirect + panel | yes (in login test) | |
| Access control | anonymous (9 pages), cross-customer `activity.htm?id=` | 1 page | 8 protected pages anonymous; cross-customer access (map section 5, untested) |

Validation coverage is high: every client-side and server-side validation message in the map is asserted for register, billpay, find-transactions, update-profile, contact and lookup. The untested items are mostly "accepted weirdness" cases that the map warns against writing as "should reject" tests, plus the access-control matrix.

### 4.2 Assertion density

Static count of `expect(`, `expect.soft(`, `expect.poll(` calls in `tests/**`: **168** across 39 source test bodies (51 runtime instances after data-driven expansion). Mean **4.3 per body** (3.3 per runtime test). Per file: overview-activity 22 (11 per body), find-transactions 19, public-pages 16, register 15, login 15, loan 14, billpay 13, update-profile 13, open-account 8, forgot-login 7, a11y 6, perf 10. Soft assertions: 18 (perf 9, billpay 2, profile 2, public 2, a11y 1, forgot-login 1, register 1).

Quality of the assertions (from the source read plus the report's audit):

- Most state-changing tests (open-account, overview, activity, transfer, billpay, loan, update-profile, register, and the find-transactions seeding) include an **API cross-check** (balances in cents, created entity, persisted profile). This is the framework's best feature.
- Lowest density: a11y public pages (1 assertion per body, but the scan helper asserts internally), forgot-login (2.3 per body), login/register negative cases (about 2-3 each, all exact text).
- Hidden assertions live in page objects (`waitUntilReady` uses `expect`), so static counts understate.
- Weakness list: soft-only tests with no count (forgot-login.spec.ts:38-40, public-pages.spec.ts:83-85), containment-only range check (find-transactions.spec.ts:81), perf budgets 4-5x the max.

### 4.3 Tag distribution (51 runtime tests; `--list` confirms 51 in 13 files)

| Tag | Tests | Share | Notes |
|---|---|---|---|
| `@smoke` | 11 | 21.6% | all also `@regression`; 10 of 11 register over HTTP |
| `@regression` | 40 | 78.4% of tests (includes the 11 smoke) | 29 regression-only + 11 smoke |
| `@a11y` | 8 | 15.7% | the JSON lists the tag 16 times: it is applied twice (describe title `Accessibility @a11y` at a11y.spec.ts:10 and per-test `tag`) |
| `@perf` | 3 | 5.9% | same duplication (`Performance budgets @perf` at perf.spec.ts:17) |
| untagged | 0 | 0% | good |

Observations: the smoke set is 22% of the suite and costs about 100 s and about 150 requests, which is the right size for a public-site job. There is no tag for "writes to shared DB" (contact form), "needs admin defaults" (loan, open-account), or "api-seeded" to let operators exclude them on a constrained site. The duplicate tags are harmless for filtering (`grep` is a regex) but inflate any tag-based reporting.

---

## 5. What to build next (summary; the precise list is in section 6)

P0 = broken or misleading now. P1 = make runs trustworthy on the public site. P2 = hardening and coverage.

---

## 6. Prioritised fix list

### P0 (do first)

**P0-1. Fix the lint failure and the silent-PASS bug in `.github/scripts/junit-summary.mjs` (CI `verify` is red, and `e2e-docker` has `needs: verify`).**

- `.github/scripts/junit-summary.mjs:14`: change
  `` new RegExp(`\b${n}="(\d+(?:\.\d+)?)"`) `` to
  `` new RegExp(String.raw`\b${n}="(\d+(?:\.\d+)?)"`) ``.
  Why: in a plain template literal `\b` is a backspace and `\d` is the letter `d`, so the regex never matches. Verified in a scratch copy: before the fix a JUnit file with `tests="3" failures="1"` printed `### PASS`, `| 0 | 0 | 0 | 0 | 0 |`; after the fix it prints `### FAIL`, `| 3 | 1 | 0 | 0 | 13 |`.
- `.github/scripts/junit-summary.mjs:28`: change `.replaceAll('|', '\|')` to `` .replaceAll('|', String.raw`\|`) `` (the current `'\|'` is just `'|'`, which is also the `no-useless-escape` error).
- `.github/scripts/junit-summary.mjs:30`: change `const bad = attr('failures') + attr('errors');` to `const bad = attr('failures') + attr('errors') || failed.length;` so a failed testcase can never produce `PASS`.
- `eslint.config.mjs:55-60` (the `**/*.mjs, **/*.js` block): add `console: 'readonly'` to `globals` and add `rules: { 'no-console': 'off' }` to the same block. This clears the 12 `no-undef`/`no-console` errors; the line-14 and line-28 edits clear the 4 `no-useless-escape` errors (16 total).
- Acceptance: `npx eslint .` exits 0; `node .github/scripts/junit-summary.mjs <junit with a failure> T` prints `FAIL` with non-zero counts.

**P0-2. Detect and classify the Cloudflare 403 challenge (and block pages) as an infrastructure failure, with one delayed retry.**

Files and exact changes:

1. `src/support/rate-limit.ts` after line 109: add `classifyCloudflare(status, headers, bodyOrTitle)` exactly as in section 2.3 and a new error class:
   ```ts
   export class CloudflareBlockedError extends Error {
     constructor(readonly kind: 'challenge' | 'block', readonly url: string, readonly status: number, readonly evidence: string) {
       super(`${kind === 'challenge' ? 'CF_CHALLENGE' : 'CF_BLOCK'}: Cloudflare answered ${status} for ${url} (${evidence}). Bot protection, not a product defect and not a Retry-After rate limit. Wait several minutes, lower RATE_LIMIT_RPM, or use a self-hosted BASE_URL.`);
       this.name = 'CloudflareBlockedError';
     }
   }
   export function throwIfCloudflare(status: number, headers: Record<string, string>, body: string, url: string): void {
     const verdict = classifyCloudflare(status, headers, body);
     if (verdict === 'rate-limit') {
       const retryAfter = parseRetryAfter(headers['retry-after']);
       recordRateLimit(retryAfter, url);
       throw new RateLimitedError(retryAfter, url);
     }
     if (verdict) throw new CloudflareBlockedError(verdict, url, status, headers['cf-mitigated'] ?? `server=${headers['server'] ?? '?'}`);
   }
   ```
   Keep `isRateLimited` as a thin wrapper (`classifyCloudflare(...) === 'rate-limit'`) for compatibility, and update its comment: it was never reachable for non-429 statuses.
2. `src/fixtures/registration.ts:21-31` (`guarded`): replace the `isRateLimited` block with:
   ```ts
   const res = await call();
   const status = res.status();
   const body = status === 429 || status === 403 || status === 503 ? await res.text() : '';
   try { throwIfCloudflare(status, res.headers(), body, res.url()); }
   catch (e) {
     if (!(e instanceof CloudflareBlockedError) || e.kind !== 'challenge' || !retryOnChallenge) throw e;
     await new Promise((r) => setTimeout(r, env.cfChallengeRetryDelaySec * 1000));
     return guarded(call, false); // replay once; Cloudflare answered before the origin, so a POST is safe to replay
   }
   return res;
   ```
   (add a `retryOnChallenge = true` parameter to `guarded`; add `env.cfChallengeRetryDelaySec = int('CF_CHALLENGE_RETRY_DELAY_S', 30)` at `src/config/env.ts` near line 111, and document it in `.env.example`.)
3. `src/fixtures/registration.ts:53`: `loginViaHttp` must not hide failures. With step 2 a challenge now throws inside `guarded`, so no change is needed there beyond a comment; confirm `return res.ok() && ...` is only reached for non-Cloudflare statuses.
4. `src/fixtures/registration.ts:62-63`: keep the `RegistrationError` but only for non-Cloudflare statuses (it now is, because `guarded` throws first).
5. `src/api/ParaBankApiClient.ts:193-203` (`text`): read the body, then call `throwIfCloudflare(res.status(), res.headers(), body, res.url())` for 403/503, keeping the existing 429 retry-once logic as is (the retry loop stays; challenge errors propagate).
6. `src/pages/BasePage.ts:58-66` (`assertNotRateLimited`): replace the 429-only check with:
   ```ts
   if (!response) return;
   const s = response.status();
   if (s === 429 || s === 403 || s === 503) {
     const body = (await response.text().catch(() => '')).slice(0, 4000);
     throwIfCloudflare(s, response.headers(), `${await page.title()}\n${body}`, response.url());
   }
   ```
7. `src/fixtures/test.ts:155-163` (response listener): extend `if (response.status() !== 429 ...)` to also handle 403/503 with a `cf-mitigated` or `server: cloudflare` header for `document`/`xhr`/`fetch` resource types, and store `CloudflareBlockedError` in the same `rateLimited` variable (rename to `infraError`). Also remove the `|| rateLimited` early return for 429 so later, longer `Retry-After` values still update the ban clock.
8. Add `docs/discovery` note or README row listing `CF_CHALLENGE`, `CF_BLOCK`, `RATE_LIMITED` as the three infra codes.

Acceptance: with a stubbed response (`status 403`, header `cf-mitigated: challenge`) a unit-level or `page.route` test shows `CF_CHALLENGE:` in the error and in a `CF_CHALLENGE` annotation, and exactly one replay with the 30 s delay. [A unit test of `classifyCloudflare` with the 6 rows of the section 2.3 table needs no network.]

**P0-3. Persist the pacing window and ban clock across worker restarts and across runs.**

- File: `src/support/rate-limit.ts:28-31` (module-level `sent`, `bannedUntil`, `lastBanUrl`) and `:44-48`, `:58-63`, `:69-75`.
- Change: back the three variables with a JSON file, default `test-results/.rate-limit-state.json` (path via `RATE_LIMIT_STATE_FILE`, ignored by git because `test-results/` is already ignored). Shape: `{ sent: number[], bannedUntil: number, lastBanUrl: string, lastCustomerId: number }`. Read at module load and at the start of `waitForBanOrFail` / `waitForHeadroom`; write (write-temp-then-rename) in `recordRateLimit` immediately, and flush `sent` at the end of each test (in `networkGuard` after `await use()` inside a `finally`) and every 20 recorded requests. Trim `sent` entries older than the longest window (`RATE_LIMIT_LONG_WINDOW_S`, default 600).
- Why: Playwright restarts the worker after any failure, so today a `RATE_LIMITED` failure erases the ban clock for the next test (evidence: tests after the run-2 failure ran on workerIndex 1), and a second run launched 21 s after the first starts with an empty window. [measured/inferred]
- Acceptance: run `npx playwright test --list` unchanged; a unit-level import test shows that `recordRateLimit(200, url)` in one process is seen by `banRemainingSec()` in a second process.

### P1 (before relying on the public-site job)

**P1-1. Nightly job: stop running the whole suite on the public site.**
`.github/workflows/nightly-public.yml:33` change `run: npm test` to
`run: npx playwright test --project=chromium --project=a11y --grep "@smoke|@a11y"` (about 19 tests, about 250 requests, under 3 min) and add to the `env:` block at line 22-24:
`RATE_LIMIT_RPM: 60`, `RATE_LIMIT_TEST_BUDGET: 40`, `RATE_LIMIT_MAX_WAIT_S: 330`, `RETRIES: 0`. Reasoning: the full suite is about 8.2 min of continuous traffic and the challenge appeared at about 9.7 min; `retries: 1` doubles the cost of any infra failure. Full regression belongs on the docker job (`ci.yml`). Note the `--grep` regex must also be accepted by the `perf` project's own `grep` (it will not match; perf is excluded on purpose).

**P1-2. Re-tune defaults for the public site.**
- `src/config/env.ts:104` (`rateLimitRpm` default for public): `90` -> `60`; `.env.example` `RATE_LIMIT_RPM=90` -> `60`; README parameter table (line 95) and rate-limit text (lines 107-118) to match.
- `src/config/env.ts:106`: `rateLimitTestBudget` `30` -> `40`; `.env.example` and README (line 96).
- Add after `src/config/env.ts:111`: `rateLimitLongWindowSec: int('RATE_LIMIT_LONG_WINDOW_S', isPublicSite ? 600 : 0)` and `rateLimitLongMax: int('RATE_LIMIT_LONG_MAX', 450)`; in `waitForHeadroom` (`rate-limit.ts:83-96`) apply the same sliding-window check to the long window (wait until `countInLast(longWindow) + want <= longMax`). Document as a hypothesis in the README until validated.
- Expected effect (with P1-6 and P1-5 applied): about 8 min wall at 60 req/min versus 8.2 min today at 90.

**P1-3. Do not re-send traffic after an infra failure (retry safety).**
`src/fixtures/test.ts:130-133`: `waitForBanOrFail()` is already called first in `networkGuard`. Make it also throw the stored `CloudflareBlockedError` for `env.cfChallengeCooldownSec` (default 120 s) after a `challenge`/`block` that survived the one delayed replay, stored in the P0-3 state file. This stops the retry and every following test from hitting a live challenge, and keeps the failure classified as B. Add `CF_CHALLENGE_COOLDOWN_S` (default 120) to `env.ts` and `.env.example`. Do not use a longer cool-down: the only observation recovered within 10 s.

**P1-4. Record what each test actually costs and label every failure.**
- `src/fixtures/test.ts`: add counters for browser requests (inside the `context.on('request')` handler at lines 145-147) and API slots (`acquireRequestSlot`). After `await use()` (line 164) push annotations `requests` = `{browser: n, api: m}` and, when `testInfo.status !== testInfo.expectedStatus`, a `failure-class` annotation with the section 2.5 rules (A=`RATE_LIMITED`, B=`CF_CHALLENGE|CF_BLOCK`, C=`DB_RESET_SUSPECTED`, D=`ASSERTION`, E=`TEST_OR_FRAMEWORK`).
- Also wrap the pacing wait in a step so it shows in the report: at `test.ts:148` use `await base.step('[rate-limit] paced', ...)` or push the existing annotation as a step. Reason: today `steps[]` hides 91% of the slow-test time.
- Use the `requests` data to replace the estimates in sections 1.4 and 1.6 with measurements; set `RATE_LIMIT_TEST_BUDGET` to the observed p90.

**P1-5. Shared-DB reset / eventual-consistency canary.**
`src/fixtures/test.ts:67-95` (`resolveRegisteredUser`): after `api.login`, compare `customer.id` with the persisted `lastCustomerId`; if lower, push annotation `DB_RESET_SUSPECTED` and throw `Error('DB_RESET_SUSPECTED: customer id N is lower than N+k seen earlier. The shared instance was probably re-initialised.')`. On the 10 s poll failure (`:89`), call `api.login(user.username, user.password)` once: success -> message "eventual consistency, accounts not visible after 10 s"; failure -> "DB_RESET_SUSPECTED". Update `lastCustomerId = max(...)` and persist it in the P0-3 file.

**P1-6. Cut request demand (the real runtime lever).**
a. `src/fixtures/test.ts:134-139` (the `context.route('**/*')` handler): add a worker-scoped `Map<string, {status, headers, body}>`; for same-origin GET requests with `resourceType` `stylesheet` or `script` and no query that depends on the session, `route.fetch()` once, store it, and `route.fulfill()` from memory afterwards. Key by URL with `;jsessionid=...` stripped. Skip caching for any response with status other than 200. Do not cache `document`, `xhr`, `fetch`. Expected -35 to -45% browser requests [unverified]. Validate with one smoke run after the cool-down by comparing the new `requests` annotation (P1-4) before and after.
b. Shared per-worker user for validation-only tests that do not mutate profile data: add a worker-scoped `sharedUser` fixture (same code as `user`/`registeredUser`) and switch these tests to it: `billpay.spec.ts:98` (3 invalid-form cases) and `:54`, `transfer.spec.ts:43` (2 negative cases), `loan` denial cases `request-loan.spec.ts:60` (2), `find-transactions.spec.ts:99,:111`, `update-profile.spec.ts:59`, `a11y.spec.ts:47`, `perf.spec.ts:~34`. Keep per-test users for tests that assert exact account lists or balances. Saves about 4 requests per test, about 50 total. Note: with one worker, tests run sequentially, so shared state cannot interleave; with more workers each worker has its own user.

### P2 (hardening, coverage, docs)

**P2-1. Replace the burst-then-stall gate with a leaky bucket at test boundaries.**
`src/support/rate-limit.ts:83-96` and `src/fixtures/test.ts:148-152`: after each test compute `cost = requests sent in that test` and `duration`; before the next test sleep `max(0, cost * 60000 / rpm - duration)` ms. Keep the sliding window as a hard ceiling. Result: same average rate, no 22-42 s stalls inside individual tests, readable duration stats.

**P2-2. Timeout safety for mid-test slot waits.**
`src/support/rate-limit.ts:99-102` (`acquireRequestSlot`): return the milliseconds waited; have `ParaBankApiClient.text` (line 186) and `registration.guarded` (line 23) call `test.info().setTimeout(test.info().timeout + waited)` when `waited > 0` (guard with try/catch for use outside a test).

**P2-3. Perf test must not time throttle waits.**
`tests/perf/perf.spec.ts:72`: before the `timed(...)` call add `await waitForHeadroom(1);` (import from `@src/support/rate-limit`). Better, add a `ParaBankApiClient.lastDurationMs` measured around `this.request.fetch` and assert on that instead.

**P2-4. Positive control for the three "no request sent" checks.**
Create `src/pages/endpoints.ts` exporting `export const Endpoint = { billpay: /\/billpay\?/, profileUpdate: /\/customers\/update\//, transactions: /\/transactions/ }`. Use the same constants in both the happy-path `waitForResponse`/`pay()`/`update()` code and in the negative-path listeners at `billpay.spec.ts:59`, `update-profile.spec.ts:64`, `find-transactions.spec.ts:116`. Add one line in each positive test asserting the predicate matched, so a renamed endpoint breaks loudly.

**P2-5. Strengthen weak assertions.**
- `tests/auth/forgot-login.spec.ts:38-40`: after the loop add `await expect(lookupPage.page.locator('#lookupForm span.error').filter({ visible: true })).toHaveCount(Object.keys(Messages.lookup.required).length);` (add an `allFieldErrors` getter to `LookupPage` mirroring `RegisterPage.ts:33`).
- `tests/public/public-pages.spec.ts:83-85`: same count assertion using a `ContactPage.allFieldErrors` getter; `:26-31` make the Site Map loop a hard `expect` count of visible links equal to `MENU_ITEMS.length`.
- `tests/transactions/find-transactions.spec.ts:81`: for the range search also assert equality with `api.findTransactionsInRange(...)` ids (like `:62-66`).
- `tests/auth/login.spec.ts:77`: extend to a matrix of the 8 other protected pages (see P2-6).

**P2-6. Missing high-value tests (all cheap in Cloudflare budget).**
1. Access-control matrix: one test using an unauthenticated `request.get` (no browser, no assets) for `openaccount.htm`, `activity.htm?id=1`, `transaction.htm?id=1`, `transfer.htm`, `billpay.htm`, `findtrans.htm`, `updateprofile.htm`, `requestloan.htm`. Assert the documented 500 + error page. About 8 requests. Tags `@regression`.
2. Find transactions by a non-existent id (`999999999`): expect the results view with 0 rows (map 2.8). 1 page, uses the `user` fixture (or the shared user from P1-6b).
3. Request loan with empty and `abc` fields: expect the generic Error! view and no new account.
4. Transaction details: assert `Description:` equals `Funds Transfer Received` in `overview-activity.spec.ts:93-98`.
5. Exploratory only, run once during a cool-down, record, then decide: contact email format; `13-45-2026` date; transfer `12.345`; cross-customer `activity.htm?id=` authorization. Do not assert until behaviour is observed.

**P2-7. Tag hygiene.**
`tests/a11y/a11y.spec.ts:10`: change describe title `'Accessibility @a11y'` to `'Accessibility'`; `tests/perf/perf.spec.ts:17`: `'Performance budgets @perf'` -> `'Performance budgets'`. The per-test `tag: '@a11y'/'@perf'` entries already drive the `grep` in `playwright.config.ts:127,162,170`. Add optional tags `@shared-db` (contact form, `public-pages.spec.ts:61`) and `@admin-defaults` (loan, open-account) so operators can exclude them.

**P2-8. Loan precondition check.**
`tests/loan/request-loan.spec.ts:11`: add a `test.beforeAll` (or first step) that reads the admin form via `adminPage` (read-only) and records provider, processor, threshold in an annotation; on failure of any loan test, the annotation shows whether admin settings drifted (class C-like, not D). One extra page load per file, not per test.

**P2-9. Correct the evidence report (`docs/evidence/EVIDENCE-REPORT.md`).**
- Section 2: "9 tests waited 22-42 s" -> 7 (22.6-41.6 s); "about 4.5 of 8.2 minutes" -> 4.2 min (250.1 s).
- Section 3 line references are off. Real locations: billpay "no request" check `billpay.spec.ts:59,:80` (not `:283`); billpay error count `:79` (not `:282`); register error count `register.spec.ts:69` (not `:214`); find-transactions "no search request" `:116,:153` (not `:384`); range containment `:81` (not `:312`); by-date comparison `:62-66` (not `:297`); perf budgets `perf.spec.ts:72-84` (not `:54,:70,:73,:83,:198`).
- Section 2: add that the challenge appeared 9 min 44 s after the first request and was a single-request event (three following registrations passed within 20 s).
- Section 6: the lint failure is fixed by P0-1; mention the silent-PASS bug.

---

## 7. What this analysis could not establish (honest gaps)

- True request counts per test, per window, and the API/browser split: not recorded anywhere (P1-4 fixes this). Every request-volume figure above is an estimate.
- Whether the 10-minute challenge is time-, volume- or reputation-triggered: one observation. The long-window cap and the 120 s cool-down are hypotheses to test in a single deliberate experiment after the cool-down.
- Behaviour under a live 429 ban, the `registration-recovered` path, and Firefox/WebKit: unexercised in the evidence runs.
- The markers for the "Just a moment" browser interstitial, WAF block pages and 52x errors come from general Cloudflare behaviour and have not been seen against this site; the 403 + `Cf-Mitigated: challenge` row and the 429 / 1015 rows are the measured ones.
- Cache-fulfilled CSS/JS (P1-6a) must be validated with one smoke run: it changes how pages render and what counts as a request.
