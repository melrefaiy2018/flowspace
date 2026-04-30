#!/usr/bin/env -S npx tsx
/**
 * Workflow Synthesizer — Kill-Criterion Evaluator (SC-002)
 *
 * Reads .tool-invocation-log.<account>.json from DATA_DIR, mines contiguous
 * tool-name n-grams of length 2–5, and emits a verdict on whether to proceed
 * to User Story 2 (proposal UI) or shelve it.
 *
 * Usage:
 *   npx tsx scripts/synthesizer-eval.ts                  # uses default DATA_DIR
 *   FLOWSPACE_DATA_DIR=/path/to/dir npx tsx scripts/synthesizer-eval.ts
 *   npx tsx scripts/synthesizer-eval.ts --account alice  # specific account
 *
 * Decision rule (per specs/007-workflow-synthesizer/spec.md SC-002):
 *   ≥ 3 distinct candidate sequences → PROCEED with US2 (T033–T050)
 *   < 3 distinct candidates          → SHELVE US2/US3, revisit in 60 days
 *   no log file or empty log         → EXTEND dogfood window 7 more days
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface LogEntry {
  id: string;
  name: string;
  argsHash: string;
  timestamp: string;
  success: boolean;
  approval: string;
  source: 'chat' | 'scheduler';
}

const MIN_LEN = 2;
const MAX_LEN = 5;
const MIN_OCCURRENCES = 3;
const LOOK_BACK_DAYS = 14;

function getDataDir(): string {
  if (process.env.FLOWSPACE_DATA_DIR) return path.resolve(process.env.FLOWSPACE_DATA_DIR);
  if (process.env.NODE_ENV === 'production' || process.env.FLOWSPACE_PRODUCTION === '1') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace');
  }
  return process.cwd();
}

function findLogFile(dir: string, account?: string): string | null {
  if (account) {
    const fp = path.join(dir, `.tool-invocation-log.${account}.json`);
    return fs.existsSync(fp) ? fp : null;
  }
  let candidates: string[] = [];
  try {
    candidates = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('.tool-invocation-log.') && f.endsWith('.json'))
      .map((f) => path.join(dir, f));
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;
  return candidates[0];
}

function readLog(filePath: string): LogEntry[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries as LogEntry[];
  } catch {
    return [];
  }
}

function withinWindow(entries: LogEntry[], days: number): LogEntry[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return entries.filter((e) => {
    const t = Date.parse(e.timestamp);
    return Number.isFinite(t) && t >= cutoff;
  });
}

function countNgrams(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (let len = MIN_LEN; len <= MAX_LEN; len++) {
    for (let i = 0; i + len <= names.length; i++) {
      const key = names.slice(i, i + len).join(' → ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function main(): void {
  const args = process.argv.slice(2);
  const accountIdx = args.indexOf('--account');
  const account = accountIdx >= 0 ? args[accountIdx + 1] : undefined;

  const dir = getDataDir();
  const logPath = findLogFile(dir, account);

  console.log('=== Workflow Synthesizer — Dogfood Evaluation (SC-002) ===\n');
  console.log(`Data dir: ${dir}`);

  if (!logPath) {
    console.log(`Log file: NOT FOUND\n`);
    console.log('VERDICT: EXTEND');
    console.log('No invocation log found. Either the synthesizer flag was');
    console.log('never enabled, or no tool dispatches have occurred yet.');
    console.log('Recommendation: extend the dogfood window by 7 more days.');
    process.exit(0);
  }

  const entries = readLog(logPath);
  console.log(`Log file: ${path.basename(logPath)}`);
  console.log(`Total invocations recorded: ${entries.length}`);

  if (entries.length === 0) {
    console.log('\nVERDICT: EXTEND');
    console.log('Log file exists but is empty. Recommend 7-day extension.');
    process.exit(0);
  }

  const inWindow = withinWindow(entries, LOOK_BACK_DAYS);
  console.log(`Invocations within ${LOOK_BACK_DAYS}-day window: ${inWindow.length}`);

  const dispatchedNames = inWindow.map((e) => e.name);
  const ngramCounts = countNgrams(dispatchedNames);
  const candidates = [...ngramCounts.entries()]
    .filter(([, c]) => c >= MIN_OCCURRENCES)
    .sort((a, b) => b[1] - a[1]);

  console.log(`\nDistinct candidate sequences (≥ ${MIN_OCCURRENCES} occurrences): ${candidates.length}`);

  if (candidates.length > 0) {
    console.log(`\nTop ${Math.min(5, candidates.length)} sequences:`);
    candidates.slice(0, 5).forEach(([seq, count], i) => {
      console.log(`  ${i + 1}. (${count}×)  ${seq}`);
    });
  }

  console.log();
  if (candidates.length >= MIN_OCCURRENCES) {
    console.log('VERDICT: PROCEED');
    console.log(`${candidates.length} distinct candidate sequence(s) found.`);
    console.log('Recommend implementing User Story 2 (tasks T033–T050 in');
    console.log('specs/007-workflow-synthesizer/tasks.md).');
  } else {
    console.log('VERDICT: SHELVE');
    console.log(`Only ${candidates.length} distinct candidate(s) — below the threshold of ${MIN_OCCURRENCES}.`);
    console.log('Recommend filing a follow-up ticket to revisit in 60 days.');
    console.log('Do NOT build US2/US3 on insufficient signal.');
  }
}

main();
