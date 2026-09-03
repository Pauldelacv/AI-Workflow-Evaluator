#!/usr/bin/env node
/**
 * Seed the local run store with the three demo runs, in the order a real
 * engagement produces them: baseline, fix, cost experiment.
 *
 * This is what makes `npm run seed && npm run dev` a five-minute demo - the
 * dashboard, the comparison view and the regression report all have data.
 */
import { DEFAULT_REGRESSION_POLICY, DEFAULT_RUN_CONFIG } from '../lib/config';
import { findWorkflow, loadDatasetBundle } from '../lib/datasets';
import { runEvaluation } from '../lib/evaluator';
import { HeuristicJudge } from '../lib/judge';
import { createProvider } from '../lib/providers';
import { detectRegression } from '../lib/regression';
import { RunStore } from '../lib/runs/store';
import type { Run } from '../lib/types';
import { pct, seconds, usd } from '../lib/display';

const DATASET_ID = process.argv[2] ?? 'acme-support';
const VERSIONS = ['v1-baseline', 'v2-grounded', 'v3-cost-optimised'];

async function main(): Promise<void> {
  const bundle = loadDatasetBundle(DATASET_ID);
  const store = new RunStore();
  const runs: Run[] = [];

  for (const version of VERSIONS) {
    const workflow = findWorkflow(bundle, version);
    const run = await runEvaluation({
      bundle,
      workflow,
      provider: createProvider('mock', { fixturesDir: bundle.fixturesDir }),
      judge: new HeuristicJudge(),
      config: DEFAULT_RUN_CONFIG,
      concurrency: 8,
      notes: `Seeded demo run for ${version}.`,
    });
    await store.save(run);
    runs.push(run);

    console.log(
      `${run.id}  ${version.padEnd(20)} overall ${pct(run.summary.overall)}  pass ${pct(run.summary.passRate)}  ` +
        `${seconds(run.summary.meanLatencyMs)}  ${usd(run.summary.meanCostUsd)}/case`,
    );
  }

  console.log('');
  for (let index = 1; index < runs.length; index += 1) {
    const baseline = runs[index - 1]!;
    const candidate = runs[index]!;
    const report = detectRegression({ baseline, candidate, policy: DEFAULT_REGRESSION_POLICY });
    console.log(
      `${baseline.workflowVersion} -> ${candidate.workflowVersion}: ${report.verdict.toUpperCase()}` +
        `${report.blocked ? ' (BLOCKED)' : ''}` +
        `${report.newFailures.length > 0 ? `, ${report.newFailures.length} new failure(s)` : ''}`,
    );
  }

  console.log('\nSeeded. Start the UI with: npm run dev');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
