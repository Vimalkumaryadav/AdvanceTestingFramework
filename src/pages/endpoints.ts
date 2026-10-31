/**
 * The browser-side XHR endpoints the ParaBank pages call (all under `services_proxy/bank/`).
 * Used by BOTH the happy-path waits in page objects and the "no request sent" checks in
 * negative tests, so a renamed endpoint breaks the happy path loudly instead of letting the
 * negative checks pass vacuously.
 */
export const Endpoint = {
  createAccount: /\/services_proxy\/bank\/createAccount\?/,
  transfer: /\/services_proxy\/bank\/transfer\?/,
  billpay: /\/services_proxy\/bank\/billpay\?/,
  requestLoan: /\/services_proxy\/bank\/requestLoan\?/,
  profileUpdate: /\/services_proxy\/bank\/customers\/update\//,
  /** Find Transactions searches (by id, date, range, amount). */
  transactions: /\/services_proxy\/bank\/(accounts\/\d+\/)?transactions\//,
} as const;

export type EndpointName = keyof typeof Endpoint;

/** True when `url` hits the given endpoint. */
export const hits = (name: EndpointName, url: string): boolean => Endpoint[name].test(url);
