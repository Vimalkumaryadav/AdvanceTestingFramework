// Prints a Markdown test summary from a Playwright JUnit file.
// Usage: node .github/scripts/junit-summary.mjs <junit.xml> [title]
import { existsSync, readFileSync } from 'node:fs';

const [file, title = 'Test summary'] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.log(
    `### ${title}\n\nNo JUnit file found at \`${file}\` (the run probably failed before reporting).`,
  );
  process.exit(0);
}
const xml = readFileSync(file, 'utf8');
const root = /<testsuites\b([^>]*)>/.exec(xml)?.[1] ?? '';
// String.raw is required: in a plain template literal `\b` is a backspace and `\d` a plain `d`,
// so the regex never matched and the summary printed PASS with all-zero counts.
const attr = (n) => Number(new RegExp(String.raw`\b${n}="(\d+(?:\.\d+)?)"`).exec(root)?.[1] ?? 0);
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const failed = [];
for (const chunk of xml.split('<testcase ').slice(1)) {
  const body = chunk.split('</testcase>')[0];
  if (!/<(failure|error)\b/.test(body)) continue;
  const name = /\bname="([^"]*)"/.exec(body)?.[1] ?? '?';
  const cls = /\bclassname="([^"]*)"/.exec(body)?.[1] ?? '';
  failed.push(`${decode(cls)} > ${decode(name)}`.replaceAll('|', String.raw`\|`));
}
// A failed testcase can never produce PASS, even if the root attributes are missing.
const bad = attr('failures') + attr('errors') || failed.length;
console.log(`### ${bad ? 'FAIL' : 'PASS'}: ${title}\n`);
console.log(
  '| Tests | Failed | Errors | Skipped | Duration (s) |\n| --- | --- | --- | --- | --- |',
);
console.log(
  `| ${attr('tests')} | ${attr('failures')} | ${attr('errors')} | ${attr('skipped')} | ${attr('time').toFixed(0)} |\n`,
);
if (failed.length) console.log(`**Failed tests**\n\n${failed.map((f) => `- ${f}`).join('\n')}\n`);
console.log(
  '_Retried-then-passed tests count as passed in JUnit; check the HTML report for flaky markers._',
);
