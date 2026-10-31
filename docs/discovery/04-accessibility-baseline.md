# 04 - Accessibility Baseline (ParaBank)

Scanned 2026-10-31 with @axe-core/playwright, chromium, tags `wcag2a, wcag2aa, wcag21a, wcag21aa`, desktop viewport, fresh browser context. Authenticated pages were scanned after registering a unique user (`a11y<digits>`) via register.htm (registration auto-logs in). Throwaway scripts and results live in the session scratchpad (`.../scratchpad/a11y/scan.js`, `results.json`); nothing was added to the project.

Scope caveat: automated axe only (about 30% of WCAG issues). Only default page states were scanned (no post-submit result pages, no error states). No screen reader testing was done. Conformance is NOT DETERMINED; the site clearly FAILS 1.1.1, 1.3.1, 1.4.3, 2.4.4, 3.1.1 and 4.1.2 on the scanned pages.

## Summary table

Counts are nodes per rule. All violations are `critical` or `serious`; there were no moderate or minor ones.

| Page | color-contrast (serious) | html-has-lang (serious) | link-name (serious) | image-alt (critical) | label (critical) | select-name (critical) | Total rules |
|---|---|---|---|---|---|---|---|
| index | 6 | 1 | 1 | 1 | 2 | - | 5 |
| register | 14 | 1 | 1 | 1 | 13 | - | 5 |
| lookup | 10 | 1 | 1 | 1 | 9 | - | 5 |
| about | 3 | 1 | 1 | 1 | 2 | - | 5 |
| services | 56 | 1 | 1 | 1 | 2 | - | 5 |
| contact | 7 | 1 | 1 | 1 | 6 | - | 5 |
| overview | 4 | 1 | 1 | 1 | - | - | 4 |
| openaccount | 3 | 1 | 1 | 1 | - | 2 | 5 |
| transfer | 3 | 1 | 1 | 1 | 1 | 2 | 6 |
| billpay | 13 | 1 | 1 | 1 | 9 | 1 | 6 |
| findtrans | 3 | 1 | 1 | 1 | 5 | 1 | 6 |
| updateprofile | 10 | 1 | 1 | 1 | 7 | - | 5 |
| requestloan | 6 | 1 | 1 | 1 | 2 | 1 | 6 |

Public pages show the login panel (unlabelled username/password inputs, so `label` has at least 2 nodes). Authenticated pages show the logged-in nav instead, so `label` disappears on overview and openaccount. Node counts for color-contrast can drift (services = 56 depends on table content); assert on rule ids, never on exact counts.

## Per-page violations (rule, impact, nodes, stable targets)

### Shared on EVERY page (site template defects)
- `html-has-lang` serious, 1: `html` (WCAG 3.1.1). Fix: `<html lang="en">`.
- `image-alt` critical, 1: `.admin` (admin gear image in `#topPanel`, WCAG 1.1.1).
- `link-name` serious, 1: `#topPanel > a[href$="admin.htm"]` (link wraps the alt-less image, WCAG 2.4.4 / 4.1.2). On index the target is `#topPanel > a:nth-child(1)`.
- `color-contrast` serious, always includes `.caption` (banner caption). Authenticated pages and about also include `.visit > li:nth-child(1)` and `a[href$="parasoft.com/"]` (footer). Form pages also include the bold label cells `tr:nth-child(N) > td[align="right"][width="30%"] > b`.

### Public pages
- index: color-contrast 6 (`.caption`, `.captionone`, `.captiontwo`, `.captionthree`, ...); label 2 (`input[type="text"]`, `input[type="password"]` = login form).
- register: color-contrast 14 (`.caption`, `tr:nth-child(1..) > td[align="right"][width="30%"] > b`); label 13 (`input[name="username"]`, `input[name="password"]`, `#customer\.firstName`, `#customer\.lastName`, ... all registration fields).
- lookup: color-contrast 10; label 9 (login inputs, `#firstName`, `#lastName`, ...).
- about: color-contrast 3 (`.caption`, `.visit > li:nth-child(1)`, `a[target="_blank"]`); label 2 (login).
- services: color-contrast 56 (`.caption`, `table:nth-child(11) > tbody > tr:nth-child(1) > td[...]`, ...); label 2 (login).
- contact: color-contrast 7; label 6 (login, `#name`, `#email`, ...).

### Authenticated pages
- overview: color-contrast 4 (`.caption`, `td[colspan="3"]`, `.visit > li:nth-child(1)`, `a[href$="parasoft.com/"]`). No label or select issues.
- openaccount: color-contrast 3; select-name 2 (`#type`, `#fromAccountId`).
- transfer: color-contrast 3; label 1 (`#amount`); select-name 2 (`#fromAccountId`, `#toAccountId`).
- billpay: color-contrast 13; label 9 (`input[name="payee.name"]`, `input[name="payee.address.street"]`, `...city`, `...state`, ...); select-name 1 (`select`).
- findtrans: color-contrast 3; label 5 (`#transactionId`, `#transactionDate`, `#fromDate`, `#toDate`, ...); select-name 1 (`#accountId`).
- updateprofile: color-contrast 10; label 7 (`#customer\.firstName`, `#customer\.lastName`, `#customer\.address\.street`, `#customer\.address\.city`, ...).
- requestloan: color-contrast 6; label 2 (`#amount`, `#downPayment`); select-name 1 (`#fromAccountId`).

Root cause of `label` / `select-name`: ParaBank renders `<td><b>First Name:</b></td><td><input></td>` tables with no `<label for>` and no aria-label, so inputs have no programmatic name. This is also why Playwright `getByLabel` will NOT work on this site; use ids/names (`#customer\.firstName`, `input[name="username"]`).

## Keyboard-only checks (login form on index.htm, register form)

Method: fresh context, press Tab up to 25 times, read `document.activeElement` and its computed outline.

- Tab order: logical and matches visual order. Login: (username, inferred as autofocused because the first Tab landed on password) -> password -> Log In -> Forgot login info? -> Register -> content links -> footer nav -> www.parasoft.com. Register: login panel (password, Log In, Forgot, Register), then firstName, lastName, street, city, state, zipCode, phoneNumber, ssn, username, password, repeatedPassword, Register button, then footer links. No keyboard traps (focus leaves to the browser chrome after the last link). The admin image link in the header was not observed as a tab stop.
- Focus visibility: PASS. Every focused element showed the browser default focus ring (`outline: auto 1px`); no `outline: none` overrides observed. Contrast of the ring itself was not measured.
- Form labels: FAIL. 0 of the focused inputs had an associated `<label>` (`element.labels` empty) or aria-label on both login and register (WCAG 1.3.1, 3.3.2, 4.1.2).
- Skip link / landmarks: no skip link observed in tab order (likely WCAG 2.4.1 gap; manual finding, axe did not flag it).
- Not tested: form error announcement, status/live regions, 200%/400% zoom, reduced motion, screen readers.

## What works
Tab order is logical, no keyboard traps, native focus indicators are intact, and no additional axe rules fired (no duplicate-id, heading-order, landmark, or ARIA misuse violations at these tags).

## RECOMMENDATION: how the framework should assert a11y

1. Use `AxeBuilder` with tags `['wcag2a','wcag2aa','wcag21a','wcag21aa']` from a shared helper, run once the page is stable (authenticated pages: after the page heading is visible, not just navigation).
2. Gate policy: FAIL only on violations with impact `critical` or `serious` whose rule id is NOT in the page's allowlist (`global` + `pages[page]` below). Everything else (moderate/minor, or allowlisted) is attached to the Playwright report as a JSON attachment and logged, never failing.
3. Allowlist by rule id, not by node count or selector: counts drift with content. Rule-level allowlisting still catches any brand-new rule (e.g. `button-name`, `duplicate-id`, `aria-*`) on any page, which is the regression class that matters. Optional stricter tier behind a config flag: also fail if a page's node count for an allowlisted rule exceeds `baselineNodeCounts` by more than 25% (minimum +2), to catch a form gaining unlabelled fields. Keep it optional because ParaBank is a shared third-party demo.
4. Stale-allowlist check as a non-failing warning: log allowlisted rules that no longer appear so the file can be tightened.
5. `global` rules (template-level) each have exactly 1 node on every page.
6. Add a non-gating "strict" tag (e.g. `@a11y-strict`) that runs with an empty allowlist and is excluded from CI gating, so the full defect list stays visible.
7. Locators must not depend on labels (none exist); use ids/names. Do not build `getByLabel` page-object locators for ParaBank forms.
8. Keyboard tests that are safe to assert: Tab reaches each registration field in the order above; focus indicator is not `outline: none` / zero width. Do NOT assert label association (known defect).
9. Result and error states (register success, transfer result, billpay result, findtrans results, requestloan result, failed login) were not scanned. Start each with the global + parent page list, run once, and extend the baseline.
10. Authenticated scans should register a fresh user per worker rather than reusing a shared account.

### Allowlist JSON (key = page name without `.htm`; `global` is merged into every page)

```json
{
  "gatedImpacts": ["critical", "serious"],
  "global": ["color-contrast", "html-has-lang", "image-alt", "link-name"],
  "pages": {
    "index":         ["label"],
    "register":      ["label"],
    "lookup":        ["label"],
    "about":         ["label"],
    "services":      ["label"],
    "contact":       ["label"],
    "overview":      [],
    "openaccount":   ["select-name"],
    "transfer":      ["label", "select-name"],
    "billpay":       ["label", "select-name"],
    "findtrans":     ["label", "select-name"],
    "updateprofile": ["label"],
    "requestloan":   ["label", "select-name"]
  },
  "baselineNodeCounts": {
    "index":         { "color-contrast": 6,  "label": 2 },
    "register":      { "color-contrast": 14, "label": 13 },
    "lookup":        { "color-contrast": 10, "label": 9 },
    "about":         { "color-contrast": 3,  "label": 2 },
    "services":      { "color-contrast": 56, "label": 2 },
    "contact":       { "color-contrast": 7,  "label": 6 },
    "overview":      { "color-contrast": 4 },
    "openaccount":   { "color-contrast": 3,  "select-name": 2 },
    "transfer":      { "color-contrast": 3,  "label": 1, "select-name": 2 },
    "billpay":       { "color-contrast": 13, "label": 9, "select-name": 1 },
    "findtrans":     { "color-contrast": 3,  "label": 5, "select-name": 1 },
    "updateprofile": { "color-contrast": 10, "label": 7 },
    "requestloan":   { "color-contrast": 6,  "label": 2, "select-name": 1 }
  }
}
```

`baselineNodeCounts` is only used by the optional drift tier (item 3). For `html-has-lang`, `image-alt` and `link-name` the baseline is 1 node per page.
