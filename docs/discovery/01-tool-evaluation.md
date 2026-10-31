# 01 - Supporting Tool Evaluation (Decision Record)

Date: 2026-10-31. Fixed: TypeScript, @playwright/test 1.64.1. Versions below verified with `npm view` today.
Scope: ParaBank demo UI suite, small team, GitHub Actions CI. Bias: lean, few moving parts.

## Summary table

| Area | Decision | Exact version |
|---|---|---|
| Test data | @faker-js/faker (seeded) | 10.6.0 |
| Env/config | Node `--env-file` + typed `config.ts`; no dotenv | n/a (built in) |
| Reporting | Built-in `html` + `list`/`dot` + `junit` (CI); skip Allure/Monocart for now | n/a (built in) |
| Lint | ESLint flat config + typescript-eslint + eslint-plugin-playwright | eslint 10.14.0, @eslint/js 10.0.1, typescript-eslint 8.72.1, eslint-plugin-playwright 2.12.1 |
| Format | Prettier | 3.9.10 |
| Accessibility | Keep @axe-core/playwright, scoped use | 4.14.0 |
| Logging | `test.step` + annotations + attachments; no logger lib | n/a |
| Pre-commit | Skip husky/lint-staged; enforce in CI | n/a |
| Node (CI + .nvmrc) | Node 24 (Active LTS) | 24 |

## Blocking findings (act before building)

1. **TypeScript 7.0.2 is installed but typescript-eslint 8.72.1 declares peer `typescript >=4.8.4 <6.1.0`.**
   Linting with the current devDependency will fail peer resolution or be unsupported. Either pin
   `typescript` to the 6.0.x line (verify with `npm view typescript@6 version`) or drop typed-linting.
   Playwright itself transpiles TS via its own loader, so tsc is only needed for `tsc --noEmit`.
   Recommendation: pin TypeScript to latest 6.0.x until typescript-eslint widens its peer range.
2. **Local Node 21.6.2 is unsupported by the toolchain.** eslint 10.14.0 needs `^20.19 || ^22.13 || >=24`;
   lint-staged 17 needs `>=22.22.1`; faker 10.6.0 needs `^20.19 || ^22.13 || ^23.5 || >=24`.
   Node 21 is odd-numbered (never LTS, EOL). Upgrade the dev machine to Node 24.
3. **@types/node 26.6.6 does not match the Node runtime we pin (24).** Use `@types/node@^24` (24.19.2 today)
   so type-checking cannot accept APIs absent at runtime.

## Test-data generation: @faker-js/faker 10.6.0
Rationale: ParaBank registration needs many unique fields (username, SSN, phone, address); faker gives
realistic values and a `faker.seed()` makes failures reproducible. Hand-rolled generators re-implement
this poorly. Rule: wrap faker in one `data/factories/` module, seed from `TEST_SEED` env (log the seed),
and suffix usernames with a timestamp/worker index to avoid collisions on the shared public site.

## Env/config: Node `--env-file` + typed config module
Rationale: Node 24 supports `--env-file` natively, so dotenv (18.0.9) adds a dependency for nothing.
Playwright workers inherit `process.env`, but the config file itself is evaluated in the runner process;
load with `NODE_OPTIONS=--env-file=.env` or `node --env-file-if-exists=.env` in npm scripts
(`--env-file-if-exists` avoids failures in CI where no file exists). Read all variables in ONE
`src/config/env.ts` that validates and exports typed values (BASE_URL default
`https://parabank.parasoft.com/parabank`, TEST_SEED, CI flags). Commit `.env.example`, gitignore `.env`.
Fallback if Windows shell quoting becomes painful: add dotenv 18.0.9 later; it is a drop-in change.

## Reporting: built-in HTML + junit, nothing more (yet)
Rationale: built-in HTML with trace viewer covers triage; junit XML feeds GitHub check summaries and
any later dashboard. Config: `reporter: process.env.CI ? [['dot'],['html',{open:'never'}],['junit',{outputFile:'results/junit.xml'}]] : [['list'],['html',{open:'on-failure'}]]`.
Upload `playwright-report/` and `test-results/` as artifacts (`if: always()`). `trace: 'on-first-retry'`,
`screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`.
Deferred options: allure-playwright 3.14.0 (adds history/trends but needs a separate report generator and
hosting; revisit if stakeholders need trend dashboards); monocart-reporter 2.15.1 (only if coverage or a
single-file rich report is demanded). Rejected for now to keep the dependency surface small.

## Lint/format
- ESLint 10.14.0 flat config (`eslint.config.ts` or `.mjs`) with `@eslint/js` 10.0.1, `typescript-eslint` 8.72.1
  (`recommended` plus `recommendedTypeChecked` only after finding 1 is resolved), and
  `eslint-plugin-playwright` 2.12.1 (`playwright.configs['flat/recommended']`).
- Rules that matter most: `no-floating-promises`, `playwright/no-wait-for-timeout`, `no-force-option`,
  `no-focused-test`, `missing-playwright-await`, `expect-expect`.
- Prettier 3.9.10 for formatting, with `eslint-config-prettier` omitted: run Prettier separately
  (`prettier --check .`) rather than as an ESLint rule, to keep lint fast and diagnostics clean.
  Verify `eslint-config-prettier` need only if style rules conflict (we enable no stylistic rules).
- Scripts: `lint`, `format:check`, `typecheck` (`tsc --noEmit`); CI runs all three before tests.

## Accessibility: confirm @axe-core/playwright 4.14.0
Rationale: peer is `playwright-core >=1.0.0`, so compatible with 1.64.1; it is the de-facto standard and
already installed. Use a small `a11yCheck(page)` helper in a dedicated `@a11y` tag/project, scanning key
pages (home, login, accounts overview, transfer). Restrict to tags `wcag2a, wcag2aa, wcag21aa`.
Expect pre-existing violations on this third-party demo site: baseline known rule IDs in an allowlist
file and fail only on new ones, otherwise the suite is red permanently. Attach the axe JSON to the report.

## Logging: test.step + annotations, no logger library
Rationale: `test.step` appears in HTML report, trace and junit, which is the only place anyone reads
logs; a logger lib (pino/winston) duplicates it into console noise across parallel workers. Practice:
wrap page-object actions in `test.step`, use `test.info().annotations.push` for ticket/seed metadata,
`testInfo.attach` for API payloads and axe results. Allow `console.*` only through a lint-approved
tiny `debug()` wrapper gated on `DEBUG=pw:*`/env flag if needed.

## Pre-commit hooks: not worth it now
Rationale: husky 9.1.7 and lint-staged 17.6.0 (requires Node >=22.22.1) add install-time hooks,
bypassable with `--no-verify`, and slow commits on Windows. CI is the real gate (lint, format:check,
typecheck, `playwright test --list` smoke). Revisit when more than ~3 contributors or repeated
format-only CI failures. Cheaper interim: a documented `npm run verify` script.

## Node version: pin 24
Playwright 1.64.1 requires `node >=20`, but eslint 10 and lint-staged 17 shrink the usable set, and
Node 20 is end-of-life by Apr 2026. Node 24 is Active LTS. Add `.nvmrc` containing `24`, set
`"engines": {"node": ">=24"}` in package.json, and in GitHub Actions use
`actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`. Use `npx playwright install --with-deps chromium`
(cache `~/.cache/ms-playwright` keyed on the lockfile). Node 22 (>=22.13) is an acceptable fallback.

## Open items for the caller
- Decide TypeScript pin (finding 1) before adding typescript-eslint.
- Upgrade local Node to 24 (finding 2) and align @types/node (finding 3).
- No package.json changes or installs were made by this evaluation.
