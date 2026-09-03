#!/usr/bin/env node
/**
 * `awe` - the AI Workflow Evaluator command line.
 *
 * The CLI and the web UI call exactly the same `lib/` code. That is deliberate:
 * the number CI blocks on and the number a stakeholder sees in the browser come
 * from one implementation, so they can never drift.
 */
import { DEFAULT_REGRESSION_POLICY, DEFAULT_RUN_CONFIG } from '../lib/config';
import { findWorkflow, listDatasetIds, loadDatasetBundle } from '../lib/datasets';
import { runEvaluation } from '../lib/evaluator';
import { createJudge, isJudgeId, type JudgeId } from '../lib/judge';
import { createProvider, isProviderId, type ProviderId } from '../lib/providers';
import { detectRegression } from '../lib/regression';
import { RunStore } from '../lib/runs/store';
import { effectivePassed } from '../lib/types';
import {
  bold,
  dim,
  green,
  pct,
  red,
  renderCategoryBreakdown,
  renderComparison,
  renderFailures,
  renderRunSummary,
  seconds,
  table,
  usd,
  yellow,
} from './format';

const USAGE = `${bold('awe')} - AI Workflow Evaluator

  npm run eval -- <command> [options]

${bold('Commands')}
  run <dataset> <workflow>     Evaluate a workflow version against a dataset
  compare <baseline> <cand>    Compare two existing runs
  list [dataset]               List stored runs
  show <runId>                 Show a run summary and its failures
  datasets                     List available datasets and workflow versions
  validate <dataset>           Validate a dataset and its workflows, then exit

${bold('Options for `run`')}
  --provider <mock|anthropic>  Default: mock (offline, deterministic)
  --judge <heuristic|llm>      Default: heuristic (offline, deterministic)
  --judge-model <model>        Model for the LLM judge (default: claude-opus-5)
  --baseline <runId|auto|none> Compare against a baseline. "auto" picks the most
                               recent run for the same dataset. Default: auto
  --fail-on-regression         Exit 1 when the regression policy blocks the run
  --concurrency <n>            Parallel cases (default: 4)
  --json                       Print the run as JSON instead of a report
  --quiet                      Suppress per-case progress

${bold('Examples')}
  npm run eval -- run acme-support v1-baseline --baseline none
  npm run eval -- run acme-support v2-grounded --fail-on-regression
  npm run eval -- compare run_abc123 run_def456
`;

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }

  return { command: positionals[0] ?? '', positionals: positionals.slice(1), flags };
}

function flagString(flags: ParsedArgs['flags'], name: string, fallback: string): string {
  const value = flags.get(name);
  return typeof value === 'string' ? value : fallback;
}

class UsageError extends Error {}

async function commandRun(args: ParsedArgs): Promise<number> {
  const [datasetId, workflowVersion] = args.positionals;
  if (!datasetId || !workflowVersion) {
    throw new UsageError('Usage: run <dataset> <workflow-version>');
  }

  const providerId = flagString(args.flags, 'provider', 'mock');
  if (!isProviderId(providerId)) throw new UsageError(`Unknown provider "${providerId}"`);

  const judgeId = flagString(args.flags, 'judge', 'heuristic');
  if (!isJudgeId(judgeId)) throw new UsageError(`Unknown judge "${judgeId}"`);

  const bundle = loadDatasetBundle(datasetId);
  const workflow = findWorkflow(bundle, workflowVersion);
  const provider = createProvider(providerId as ProviderId, { fixturesDir: bundle.fixturesDir });
  const judge = createJudge(judgeId as JudgeId, {
    provider,
    model: flagString(args.flags, 'judge-model', 'claude-opus-5'),
  });

  const quiet = args.flags.get('quiet') === true || args.flags.get('json') === true;
  if (!quiet) {
    console.log(
      `${bold('Running')} ${workflow.id}@${workflow.version} on ${bundle.dataset.cases.length} cases ` +
        `${dim(`(provider=${provider.id}, judge=${judge.id})`)}`,
    );
  }

  const run = await runEvaluation({
    bundle,
    workflow,
    provider,
    judge,
    config: DEFAULT_RUN_CONFIG,
    concurrency: Number(flagString(args.flags, 'concurrency', '4')) || 4,
    onProgress: quiet
      ? undefined
      : (progress) => {
          const mark = progress.passed ? green('PASS') : red('FAIL');
          const width = String(progress.total).length;
          console.log(
            `  ${dim(`[${String(progress.completed).padStart(width)}/${progress.total}]`)} ${mark} ${progress.caseId}`,
          );
        },
  });

  const store = new RunStore();
  await store.save(run);

  if (args.flags.get('json') === true) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    console.log(`\n${renderRunSummary(run)}\n`);
    console.log(`${bold('By category')}\n${renderCategoryBreakdown(run)}\n`);
    const failing = run.results.filter((result) => !effectivePassed(result)).length;
    if (failing > 0) {
      console.log(`${bold(`Failing cases (${failing})`)}\n\n${renderFailures(run, 5)}\n`);
      console.log(dim(`Full detail: npm run eval -- show ${run.id}`));
    }
  }

  // Baseline comparison. `auto` picks the most recent earlier run on the same
  // dataset, which is what you want when iterating on a prompt.
  const baselineFlag = flagString(args.flags, 'baseline', 'auto');
  if (baselineFlag === 'none') return 0;

  const baselineId =
    baselineFlag === 'auto' ? (await store.latestFor(run.datasetId, undefined, run.id))?.id : baselineFlag;

  if (!baselineId) {
    if (!quiet) console.log(dim('\nNo baseline run yet - this run becomes the baseline.'));
    return 0;
  }

  const baseline = await store.require(baselineId);
  const report = detectRegression({ baseline, candidate: run, policy: DEFAULT_REGRESSION_POLICY });

  if (args.flags.get('json') !== true) {
    console.log(`\n${bold('Comparison vs baseline')}\n\n${renderComparison(report, baseline, run)}`);
  }

  return report.blocked && args.flags.get('fail-on-regression') === true ? 1 : 0;
}

async function commandCompare(args: ParsedArgs): Promise<number> {
  const [baselineId, candidateId] = args.positionals;
  if (!baselineId || !candidateId) throw new UsageError('Usage: compare <baseline-run-id> <candidate-run-id>');

  const store = new RunStore();
  const [baseline, candidate] = await Promise.all([store.require(baselineId), store.require(candidateId)]);
  const report = detectRegression({ baseline, candidate, policy: DEFAULT_REGRESSION_POLICY });

  if (args.flags.get('json') === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderComparison(report, baseline, candidate));
  }

  return report.blocked && args.flags.get('fail-on-regression') === true ? 1 : 0;
}

async function commandList(args: ParsedArgs): Promise<number> {
  const store = new RunStore();
  const entries = await store.list({ datasetId: args.positionals[0] });
  if (entries.length === 0) {
    console.log(dim('No runs yet. Try: npm run eval -- run acme-support v1-baseline'));
    return 0;
  }
  console.log(
    table(
      ['run id', 'workflow', 'overall', 'pass', 'latency', 'cost/case', 'created'],
      entries.map((entry) => [
        entry.id,
        `${entry.workflowId}@${entry.workflowVersion}`,
        pct(entry.overall),
        pct(entry.passRate),
        seconds(entry.meanLatencyMs),
        usd(entry.meanCostUsd),
        entry.createdAt.replace('T', ' ').slice(0, 19),
      ]),
    ),
  );
  return 0;
}

async function commandShow(args: ParsedArgs): Promise<number> {
  const runId = args.positionals[0];
  if (!runId) throw new UsageError('Usage: show <run-id>');
  const run = await new RunStore().require(runId);

  if (args.flags.get('json') === true) {
    console.log(JSON.stringify(run, null, 2));
    return 0;
  }

  console.log(`${renderRunSummary(run)}\n`);
  console.log(`${bold('By category')}\n${renderCategoryBreakdown(run)}\n`);
  console.log(`${bold('Failing cases')}\n\n${renderFailures(run, 50)}`);
  return 0;
}

function commandDatasets(): number {
  const ids = listDatasetIds();
  if (ids.length === 0) {
    console.log(dim('No datasets found under examples/.'));
    return 0;
  }
  for (const id of ids) {
    const bundle = loadDatasetBundle(id);
    console.log(`${bold(id)}  ${dim(`${bundle.dataset.cases.length} cases, hash ${bundle.hash}`)}`);
    console.log(`  ${bundle.dataset.name}`);
    for (const workflow of bundle.workflows) {
      console.log(
        `    ${workflow.version.padEnd(20)} ${dim(`model=${workflow.model} retrieval=${workflow.retrieval}/${workflow.retrievalTopK}`)}`,
      );
    }
  }
  return 0;
}

function commandValidate(args: ParsedArgs): number {
  const datasetId = args.positionals[0];
  if (!datasetId) throw new UsageError('Usage: validate <dataset>');

  const bundle = loadDatasetBundle(datasetId);
  console.log(green(`Dataset "${datasetId}" is valid.`));
  console.log(`  ${bundle.dataset.cases.length} cases, ${bundle.dataset.knowledgeBase.length} knowledge snippets`);
  console.log(`  ${bundle.workflows.length} workflow version(s): ${bundle.workflows.map((w) => w.version).join(', ')}`);
  console.log(`  content hash: ${bundle.hash}`);

  // Warn on cases whose grounding references cannot be retrieved by any
  // workflow: they will fail for a reason that is not the model's fault, and
  // whoever reads the results deserves to know that up front.
  const withoutKeyPoints = bundle.dataset.cases.filter((testCase) => testCase.keyPoints.length === 0);
  if (withoutKeyPoints.length > 0) {
    console.log(yellow(`  ${withoutKeyPoints.length} case(s) have no key points; completeness will be vacuous.`));
  }
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'run':
      return commandRun(args);
    case 'compare':
      return commandCompare(args);
    case 'list':
      return commandList(args);
    case 'show':
      return commandShow(args);
    case 'datasets':
      return commandDatasets();
    case 'validate':
      return commandValidate(args);
    case '':
    case 'help':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      throw new UsageError(`Unknown command "${args.command}"`);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`${red('error')} ${error.message}\n`);
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
    console.error(`${red('error')} ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.AWE_DEBUG && error instanceof Error) console.error(error.stack);
    process.exitCode = 2;
  });
