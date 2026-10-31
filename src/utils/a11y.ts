import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import allowlistJson from '../data/a11y-allowlist.json';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Allowlist {
  gatedImpacts: string[];
  global: string[];
  pages: Record<string, string[]>;
  baselineNodeCounts: Record<string, Record<string, number>>;
}

const allowlist = allowlistJson as Allowlist;

export type A11yPageKey = keyof typeof allowlistJson.pages;

export interface A11yViolationSummary {
  id: string;
  impact: string | null | undefined;
  nodes: number;
  help: string;
  targets: string[];
}

export interface A11yReport {
  page: string;
  /** Gated-impact violations whose rule id is not allowlisted. These fail the test. */
  blocking: A11yViolationSummary[];
  /** Allowlisted or non-gated violations, reported only. */
  known: A11yViolationSummary[];
  /** Allowlisted rule ids that no longer fire: candidates for tightening the allowlist. */
  stale: string[];
  /** Allowlisted rules whose node count grew >25% (min +2) over baseline. Informational unless strict counts are on. */
  drift: string[];
}

export interface A11yScanOptions {
  /** Ignore the allowlist entirely (the non-gating @a11y-strict view). */
  strict?: boolean;
  /** Optional CSS selectors to exclude from the scan. */
  exclude?: string[];
}

/**
 * Runs axe with the project's WCAG tags and classifies results against
 * src/data/a11y-allowlist.json (rule-level allowlist, see docs/discovery/04).
 * The full report is always attached to the test.
 */
export async function scanA11y(
  page: Page,
  pageKey: A11yPageKey,
  testInfo: TestInfo,
  options: A11yScanOptions = {},
): Promise<A11yReport> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const sel of options.exclude ?? []) builder = builder.exclude(sel);
  const results = await builder.analyze();

  const allowed = new Set(
    options.strict ? [] : [...allowlist.global, ...(allowlist.pages[pageKey] ?? [])],
  );
  const gated = new Set(allowlist.gatedImpacts);

  const summaries: A11yViolationSummary[] = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));

  const blocking = summaries.filter((v) => gated.has(v.impact ?? '') && !allowed.has(v.id));
  const known = summaries.filter((v) => !blocking.includes(v));
  const firing = new Set(summaries.map((v) => v.id));
  const stale = [...allowed].filter((id) => !firing.has(id));

  const baseline = allowlist.baselineNodeCounts[pageKey] ?? {};
  const drift = summaries
    .filter((v) => baseline[v.id] !== undefined)
    .filter((v) => v.nodes > Math.max(baseline[v.id] * 1.25, baseline[v.id] + 2))
    .map((v) => `${v.id}: ${v.nodes} nodes (baseline ${baseline[v.id]})`);

  const report: A11yReport = { page: pageKey, blocking, known, stale, drift };
  await testInfo.attach(`a11y-${pageKey}${options.strict ? '-strict' : ''}.json`, {
    body: JSON.stringify({ report, raw: results.violations }, null, 2),
    contentType: 'application/json',
  });
  if (stale.length) {
    testInfo.annotations.push({
      type: 'a11y-stale-allowlist',
      description: `${pageKey}: ${stale.join(', ')}`,
    });
  }
  if (drift.length) {
    testInfo.annotations.push({
      type: 'a11y-drift',
      description: `${pageKey}: ${drift.join('; ')}`,
    });
  }
  return report;
}

/** Human-readable failure message listing blocking rules. */
export function formatBlocking(report: A11yReport): string {
  return report.blocking
    .map((v) => `[${v.impact}] ${v.id} (${v.nodes} nodes): ${v.help} -> ${v.targets.join(' | ')}`)
    .join('\n');
}
