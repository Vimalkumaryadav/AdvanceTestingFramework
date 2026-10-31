import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { ApiError, ParaBankApiClient } from '../api/ParaBankApiClient';
import type { Account } from '../api/types';
import { env } from '../config/env';
import { buildUser, seedFaker, type NewUser } from '../data/factories';
import * as Pages from '../pages';
import {
  CLOUDFLARE_STATUSES,
  apiRequestCount,
  blockedRemainingSec,
  cloudflareError,
  isInfraError,
  noteCustomerId,
  paceBeforeTest,
  recordInfraError,
  recordRequest,
  settleAfterTest,
  waitForBanOrFail,
  type InfraError,
} from '../support/rate-limit';
import { AccountsHelper } from './accounts';
import { loginViaHttp, registerViaHttp } from './registration';

export interface RegisteredUser extends NewUser {
  customerId: number;
  /** The CHECKING account every new customer receives (balance = admin initialBalance). */
  primaryAccountId: number;
}

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media']);
const appHost = new URL(env.baseUrl).host;

interface PageObjects {
  homePage: Pages.HomePage;
  loginErrorPage: Pages.LoginErrorPage;
  registerPage: Pages.RegisterPage;
  lookupPage: Pages.LookupPage;
  contactPage: Pages.ContactPage;
  aboutPage: Pages.AboutPage;
  servicesPage: Pages.ServicesPage;
  siteMapPage: Pages.SiteMapPage;
  adminPage: Pages.AdminPage;
  overviewPage: Pages.OverviewPage;
  openAccountPage: Pages.OpenAccountPage;
  activityPage: Pages.ActivityPage;
  transactionDetailsPage: Pages.TransactionDetailsPage;
  transferPage: Pages.TransferPage;
  billPayPage: Pages.BillPayPage;
  findTransactionsPage: Pages.FindTransactionsPage;
  updateProfilePage: Pages.UpdateProfilePage;
  requestLoanPage: Pages.RequestLoanPage;
}

interface TestFixtures extends PageObjects {
  /** Auto: seeding, asset blocking/caching, pacing, Cloudflare classification, triage annotations. */
  networkGuard: void;
  /** Unregistered user data (for UI registration / validation tests). */
  newUser: NewUser;
  /** Freshly registered over HTTP through the PAGE's context: the page is already logged in. */
  user: RegisteredUser;
  /** Freshly registered over HTTP in a SEPARATE context: the page stays anonymous. */
  registeredUser: RegisteredUser;
  /**
   * A per-worker customer with the page logged in over HTTP (2 requests instead of about 6 for a
   * fresh registration). Only for tests that do not depend on exact account lists/balances or on
   * profile data untouched by earlier tests: validation-only tests, scans, perf page loads.
   */
  sharedUser: RegisteredUser;
  /** API seeding helper bound to `user`. */
  accounts: AccountsHelper;
}

interface WorkerFixtures {
  apiRequest: APIRequestContext;
  api: ParaBankApiClient;
  /** One customer per worker, registered lazily on first use. Use it via `sharedUser`. */
  sharedAccount: RegisteredUser;
}

type Annotate = (type: string, description: string) => void;

async function resolveRegisteredUser(
  api: ParaBankApiClient,
  user: NewUser,
  annotate: Annotate,
): Promise<RegisteredUser> {
  const customer = await api.login(user.username, user.password);

  // DB-reset canary: ParaBank ids only grow, so a LOWER id than one seen earlier (this or an
  // earlier run, persisted) means the shared DB was re-initialised since. That does not hurt
  // this freshly created customer, so it is recorded, not thrown.
  const previous = noteCustomerId(customer.id);
  if (previous !== null) {
    annotate(
      'DB_RESET_SUSPECTED',
      `customer id ${customer.id} < ${previous} seen earlier: the shared instance was re-initialised (not fatal for this test).`,
    );
  }

  // Observed live: right after registration the API intermittently answers
  // "Could not find customer #N" for a customer it just returned. Poll briefly (condition-based).
  let accounts: Account[] = [];
  try {
    await expect
      .poll(
        async () => {
          try {
            accounts = await api.getAccounts(customer.id);
          } catch (e) {
            if (!(e instanceof ApiError)) throw e;
            accounts = [];
          }
          return accounts.length;
        },
        { timeout: 10_000, intervals: [500, 1_000, 2_000] },
      )
      .toBeGreaterThan(0);
  } catch (e) {
    if (isInfraError(e)) throw e;
    // Re-probe once before blaming: still able to log in = eventual consistency; not = reset.
    const stillThere = await api.login(user.username, user.password).then(
      () => true,
      (err: unknown) => {
        if (isInfraError(err)) throw err;
        return false;
      },
    );
    if (stillThere) {
      throw new Error(
        `Accounts of new customer ${customer.id} not visible via API after 10 s, although the ` +
          `customer still logs in (eventual consistency on the server).`,
      );
    }
    annotate('DB_RESET_SUSPECTED', `customer ${customer.id} vanished after registration`);
    throw new Error(
      `DB_RESET_SUSPECTED: customer ${customer.id} logged in after registration and then ` +
        `disappeared. The shared instance was probably re-initialised mid-test.`,
    );
  }
  const primary = accounts.find((a) => a.type === 'CHECKING') ?? accounts[0];
  return { ...user, customerId: customer.id, primaryAccountId: primary.id };
}

/**
 * Failure class for triage (docs/evidence/TEST-RESULTS-ANALYSIS.md section 2.5):
 * A RATE_LIMITED, B CF_CHALLENGE/CF_BLOCK, C DB_RESET_SUSPECTED, D ASSERTION, E TEST_OR_FRAMEWORK.
 */
export function classifyFailure(
  testInfo: Pick<TestInfo, 'status' | 'expectedStatus' | 'errors'>,
  infraError: InfraError | undefined,
): string | null {
  if (testInfo.status === testInfo.expectedStatus && !infraError) return null;
  const text = [
    ...testInfo.errors.map((e) => e.message ?? e.value ?? ''),
    infraError?.message ?? '',
  ]
    .join('\n')
    // strip ANSI colour codes from Playwright error messages
    // eslint-disable-next-line no-control-regex -- ESC is exactly what we strip
    .replace(/\u001b\[[0-9;]*m/g, '');
  if (/RATE_LIMITED/.test(text)) return 'A RATE_LIMITED';
  if (/CF_CHALLENGE/.test(text)) return 'B CF_CHALLENGE';
  if (/CF_BLOCK/.test(text)) return 'B CF_BLOCK';
  if (/DB_RESET_SUSPECTED/.test(text)) return 'C DB_RESET_SUSPECTED';
  if (
    /expect\(/.test(text) &&
    /Expected|Received/.test(text) &&
    !/element\(s\) not found/.test(text)
  ) {
    return 'D ASSERTION';
  }
  return 'E TEST_OR_FRAMEWORK';
}

interface CachedAsset {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Per-worker memory cache of same-origin CSS/JS (P1-6a). Keyed by URL without ;jsessionid. */
const staticCache = new Map<string, CachedAsset>();
const CACHEABLE_TYPES = new Set(['stylesheet', 'script']);
const cacheKey = (url: string) => url.replace(/;jsessionid=[^?#]*/i, '');

/** Builds a page-object fixture. The inner function must destructure `page` (Playwright reads its source). */
const po =
  <T>(Ctor: new (page: Page) => T) =>
  async ({ page }: { page: Page }, use: (value: T) => Promise<void>) => {
    await use(new Ctor(page));
  };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // ---------- worker scope ----------
  apiRequest: [
    async ({ playwright }, use) => {
      const ctx = await playwright.request.newContext({
        baseURL: env.apiBaseUrl,
        extraHTTPHeaders: { Accept: 'application/json' },
      });
      await use(ctx);
      await ctx.dispose();
    },
    { scope: 'worker' },
  ],
  api: [async ({ apiRequest }, use) => use(new ParaBankApiClient(apiRequest)), { scope: 'worker' }],
  sharedAccount: [
    async ({ playwright, api }, use) => {
      const data = buildUser();
      const ctx = await playwright.request.newContext();
      try {
        await registerViaHttp(ctx, data);
      } finally {
        await ctx.dispose();
      }
      await use(await resolveRegisteredUser(api, data, () => undefined));
    },
    { scope: 'worker' },
  ],

  // ---------- auto guard ----------
  networkGuard: [
    async ({ context }, use, testInfo) => {
      const seed = seedFaker(testInfo.testId);
      testInfo.annotations.push({
        type: 'seed',
        description: `TEST_SEED=${env.testSeed} (per-test ${seed})`,
      });

      // A ban or challenge cool-down seen earlier (this worker, a restarted worker, or the
      // previous run): wait it out within RATE_LIMIT_MAX_WAIT_S, else fail fast and classified.
      const blocked = blockedRemainingSec();
      if (blocked > 0) testInfo.setTimeout(testInfo.timeout + blocked * 1000);
      try {
        await waitForBanOrFail();
      } catch (e) {
        if (isInfraError(e)) {
          testInfo.annotations.push({ type: e.code, description: e.message });
          testInfo.annotations.push({
            type: 'failure-class',
            description: classifyFailure(testInfo, e) ?? '',
          });
        }
        throw e;
      }

      const paced = await base.step('[rate-limit] pace before test', () => paceBeforeTest());

      if (paced > 0) {
        testInfo.setTimeout(testInfo.timeout + paced);
        testInfo.annotations.push({ type: 'rate-limit-paced', description: `${paced} ms` });
      }

      // Every request goes through this handler: block heavy assets, serve CSS/JS from the
      // worker cache, and count what actually reaches the network (never delayed mid-flight).
      let browserRequests = 0;
      const countNetwork = (url: string) => {
        if (new URL(url).host !== appHost) return;
        browserRequests++;
        recordRequest();
      };
      await context.route('**/*', async (route) => {
        const req = route.request();
        const type = req.resourceType();
        try {
          if (env.blockStaticAssets && BLOCKED_RESOURCE_TYPES.has(type)) {
            await route.abort('blockedbyclient');
            return;
          }
          const cacheable =
            env.cacheStaticAssets &&
            req.method() === 'GET' &&
            CACHEABLE_TYPES.has(type) &&
            new URL(req.url()).host === appHost;
          if (!cacheable) {
            countNetwork(req.url());
            await route.fallback();
            return;
          }
          const key = cacheKey(req.url());
          const hit = staticCache.get(key);
          if (hit) {
            await route.fulfill(hit);
            return;
          }
          countNetwork(req.url());
          const response = await route.fetch();
          if (response.status() !== 200) {
            await route.fulfill({ response });
            return;
          }
          // The fetched body is already decoded: drop encoding/length headers before replaying.
          const headers = { ...response.headers() };
          delete headers['content-encoding'];
          delete headers['content-length'];
          delete headers['transfer-encoding'];
          const entry: CachedAsset = { status: 200, headers, body: await response.body() };
          staticCache.set(key, entry);
          await route.fulfill(entry);
        } catch {
          // Page/context closed while the request was in flight: nothing left to serve.
        }
      });

      // Classify Cloudflare answers on documents and XHRs. Every 429 updates the ban clock (a
      // later, longer Retry-After must win); the first infra error fails the test at teardown.
      let infraError: InfraError | undefined;
      context.on('response', async (response) => {
        const status = response.status();
        if (!CLOUDFLARE_STATUSES.includes(status)) return;
        if (new URL(response.url()).host !== appHost) return;
        if (!['document', 'xhr', 'fetch'].includes(response.request().resourceType())) return;
        const body = (await response.text().catch(() => '')).slice(0, 4000);
        const error = cloudflareError(status, response.headers(), body, response.url());
        if (!error) return;
        recordInfraError(error);
        infraError ??= error;
      });

      const apiAtStart = apiRequestCount();
      const startedAt = Date.now();
      try {
        await use();
      } finally {
        const api = apiRequestCount() - apiAtStart;
        testInfo.annotations.push({
          type: 'requests',
          description: JSON.stringify({
            browser: browserRequests,
            api,
            total: browserRequests + api,
          }),
        });
        settleAfterTest(browserRequests + api, Date.now() - startedAt);
      }

      if (infraError) {
        testInfo.annotations.push({ type: infraError.code, description: infraError.message });
      }
      const failureClass = classifyFailure(testInfo, infraError);
      if (failureClass) {
        testInfo.annotations.push({ type: 'failure-class', description: failureClass });
      }
      if (infraError) throw infraError;
    },
    { auto: true },
  ],

  // ---------- data ----------

  newUser: async ({}, use) => {
    await use(buildUser());
  },

  user: async ({ page, api }, use, testInfo) => {
    const data = buildUser();

    await base.step(`[setup] register "${data.username}" over HTTP (page session)`, async () => {
      const outcome = await registerViaHttp(page.context().request, data);
      if (outcome === 'recovered') {
        testInfo.annotations.push({ type: 'registration-recovered', description: data.username });
      }
    });

    const registered = await resolveRegisteredUser(api, data, (type, description) =>
      testInfo.annotations.push({ type, description }),
    );
    testInfo.annotations.push({
      type: 'user',
      description: `${registered.username} (customer ${registered.customerId})`,
    });
    await use(registered);
  },

  registeredUser: async ({ playwright, api }, use, testInfo) => {
    const data = buildUser();
    const ctx = await playwright.request.newContext();
    try {
      await base.step(
        `[setup] register "${data.username}" over HTTP (separate session)`,
        async () => {
          await registerViaHttp(ctx, data);
        },
      );
    } finally {
      await ctx.dispose();
    }
    const registered = await resolveRegisteredUser(api, data, (type, description) =>
      testInfo.annotations.push({ type, description }),
    );
    testInfo.annotations.push({
      type: 'user',
      description: `${registered.username} (customer ${registered.customerId})`,
    });
    await use(registered);
  },

  sharedUser: async ({ page, api, sharedAccount }, use, testInfo) => {
    await base.step(
      `[setup] log in shared user "${sharedAccount.username}" over HTTP`,
      async () => {
        if (await loginViaHttp(page.context().request, sharedAccount)) return;
        // Triage before blaming the environment: if the REST login still knows the customer,
        // the problem is our session handling (class E), not a DB reset (class C).
        const known = await api.login(sharedAccount.username, sharedAccount.password).then(
          () => true,
          (err: unknown) => {
            if (isInfraError(err)) throw err;
            return false;
          },
        );
        if (known) {
          throw new Error(
            `Form login of shared worker user "${sharedAccount.username}" (customer ` +
              `${sharedAccount.customerId}) did not reach overview.htm, although the REST login works.`,
          );
        }
        throw new Error(
          `DB_RESET_SUSPECTED: shared worker user "${sharedAccount.username}" (customer ` +
            `${sharedAccount.customerId}) no longer exists. The shared instance was re-initialised.`,
        );
      },
    );

    testInfo.annotations.push({
      type: 'user',
      description: `${sharedAccount.username} (customer ${sharedAccount.customerId}, shared per worker)`,
    });
    await use(sharedAccount);
  },

  accounts: async ({ api, user }, use) => {
    await use(new AccountsHelper(api, user.customerId, user.primaryAccountId));
  },

  // ---------- page objects ----------
  homePage: po(Pages.HomePage),
  loginErrorPage: po(Pages.LoginErrorPage),
  registerPage: po(Pages.RegisterPage),
  lookupPage: po(Pages.LookupPage),
  contactPage: po(Pages.ContactPage),
  aboutPage: po(Pages.AboutPage),
  servicesPage: po(Pages.ServicesPage),
  siteMapPage: po(Pages.SiteMapPage),
  adminPage: po(Pages.AdminPage),
  overviewPage: po(Pages.OverviewPage),
  openAccountPage: po(Pages.OpenAccountPage),
  activityPage: po(Pages.ActivityPage),
  transactionDetailsPage: po(Pages.TransactionDetailsPage),
  transferPage: po(Pages.TransferPage),
  billPayPage: po(Pages.BillPayPage),
  findTransactionsPage: po(Pages.FindTransactionsPage),
  updateProfilePage: po(Pages.UpdateProfilePage),
  requestLoanPage: po(Pages.RequestLoanPage),
});

export { expect };
