/**
 * Anonymous access to account pages, checked with plain HTTP (no browser, no assets: one request
 * per page). Behaviour verified live on 2026-10-31: no redirect to login; the server renders its
 * error page instead. Uses the base Playwright `request` fixture, paced and Cloudflare-classified
 * through sendGuarded.
 */
import { expect, test } from '@playwright/test';
import { Messages } from '@src/data/messages';
import { sendGuarded } from '@src/support/rate-limit';

const serverError = [
  'openaccount.htm',
  'transfer.htm',
  'billpay.htm',
  'findtrans.htm',
  'updateprofile.htm',
  'requestloan.htm',
];

test.describe('Anonymous access', () => {
  test(
    'account pages answer 500 with the generic error page and no account menu',
    { tag: '@regression' },
    async ({ request }) => {
      for (const path of serverError) {
        await test.step(path, async () => {
          const res = await sendGuarded(() => request.get(path, { failOnStatusCode: false }));
          const html = await res.text();
          expect.soft(res.status(), path).toBe(500);
          expect.soft(html, path).toContain('<title>ParaBank | Error</title>');
          expect.soft(html, path).toContain(Messages.generic.internalError);
          expect
            .soft(html, `${path} must not render the logged-in menu`)
            .not.toContain('logout.htm');
        });
      }
    },
  );

  const lookups = [
    { path: 'activity.htm?id=1', message: 'Could not find account # 1' },
    { path: 'transaction.htm?id=1', message: 'Could not find transaction # 1' },
  ];

  test(
    'id-based pages answer with an error page for anonymous visitors',
    { tag: '@regression' },
    async ({ request }) => {
      for (const { path, message } of lookups) {
        await test.step(path, async () => {
          const res = await sendGuarded(() => request.get(path, { failOnStatusCode: false }));
          const html = await res.text();
          const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
          expect.soft(html, path).toContain('<title>ParaBank | Error</title>');
          expect.soft(text, path).toContain(message);
          expect
            .soft(html, `${path} must not render the logged-in menu`)
            .not.toContain('logout.htm');
        });
      }
    },
  );
});
