// Polls BASE_URL (default http://localhost:8080/parabank/) until index.htm answers 200.
// Usage: node scripts/wait-for-parabank.mjs [timeoutSeconds]
const base = process.env.BASE_URL ?? 'http://localhost:8080/parabank/';
const url = new URL('index.htm', base.endsWith('/') ? base : `${base}/`).toString();
const deadline = Date.now() + Number(process.argv[2] ?? 180) * 1000;

for (;;) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      process.stdout.write(`ParaBank is up: ${url}\n`);
      process.exit(0);
    }
  } catch {
    // not listening yet
  }
  if (Date.now() > deadline) {
    process.stderr.write(`Timed out waiting for ${url}\n`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
