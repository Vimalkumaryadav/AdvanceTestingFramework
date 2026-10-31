import type { APIRequestContext } from '@playwright/test';
import { env } from '../config/env';
import { toRegisterForm, type NewUser } from '../data/factories';
import { Messages } from '../data/messages';
import { sendGuarded as guarded } from '../support/rate-limit';

export class RegistrationError extends Error {
  constructor(username: string, reason: string) {
    super(`Registering "${username}" over HTTP failed: ${reason}`);
    this.name = 'RegistrationError';
  }
}

/**
 * Registers a customer with a plain HTTP form POST, no browser UI (docs/discovery/03 section 5).
 *
 * The GET is mandatory: it creates the JSESSIONID that the Spring form depends on (a POST
 * without it returns 500). On success the session is LOGGED IN, so passing
 * `page.context().request` leaves the page authenticated. Validation failures also return
 * 200, so we detect success from the HTML, not the status code.
 */
/** POST login.htm with the given context (no prior GET needed). True when the session is logged in. */
export async function loginViaHttp(
  request: APIRequestContext,
  user: Pick<NewUser, 'username' | 'password'>,
): Promise<boolean> {
  const res = await guarded(() =>
    request.post(new URL('login.htm', env.baseUrl).toString(), {
      form: { username: user.username, password: user.password },
      failOnStatusCode: false,
    }),
  );
  // Success redirects (302) to overview.htm, which the client follows. Cloudflare answers never
  // reach this line: guarded() throws CF_CHALLENGE / CF_BLOCK / RATE_LIMITED for them.
  // A cookie-less context is redirected to `overview.htm;jsessionid=...` (URL rewriting), so match
  // the path segment, not the end of the pathname.
  return res.ok() && /\/overview\.htm(;|$)/.test(new URL(res.url()).pathname);
}

export async function registerViaHttp(
  request: APIRequestContext,
  user: NewUser,
): Promise<'created' | 'recovered'> {
  const url = new URL('register.htm', env.baseUrl).toString();
  const get = await guarded(() => request.get(url, { failOnStatusCode: false }));
  if (!get.ok())
    throw new RegistrationError(user.username, `GET register.htm -> HTTP ${get.status()}`);

  const post = await guarded(() =>
    request.post(url, { form: toRegisterForm(user), failOnStatusCode: false }),
  );
  const html = await post.text();
  if (post.ok() && html.includes(Messages.register.success)) return 'created';

  // Observed live: a single POST occasionally comes back "This username already exists." for a
  // brand-new unique username, i.e. the edge delivered the POST twice and we got the second
  // answer. Our usernames are unique per run, so if our own credentials log in, the customer is
  // ours: re-establish the session with a form login and carry on.
  if (html.includes(Messages.register.duplicateUsername) && (await loginViaHttp(request, user))) {
    return 'recovered';
  }

  const errors = [...html.matchAll(/<span[^>]*class="error"[^>]*>([^<]+)<\/span>/g)].map((m) =>
    m[1].trim(),
  );
  const reason = errors.length
    ? errors.join('; ')
    : html.includes(Messages.generic.internalError)
      ? Messages.generic.internalError
      : `HTTP ${post.status()}`;
  throw new RegistrationError(user.username, reason);
}
