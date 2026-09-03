import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { examplesDir } from '../config';
import { Dataset, Workflow } from '../types';

export interface DatasetBundle {
  dataset: Dataset;
  /** Content hash of the dataset. Two runs are only comparable at equal hashes. */
  hash: string;
  workflows: Workflow[];
  fixturesDir: string;
  dir: string;
}

/** Stable hash over the semantic content of a dataset, ignoring key order. */
export function hashDataset(dataset: Dataset): string {
  const canonical = JSON.stringify({
    id: dataset.id,
    knowledgeBase: dataset.knowledgeBase
      .map((snippet) => ({ id: snippet.id, text: snippet.text }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    cases: dataset.cases
      .map((testCase) => ({
        id: testCase.id,
        input: testCase.input,
        expected: testCase.expected,
        keyPoints: [...testCase.keyPoints].sort(),
        mustInclude: [...testCase.mustInclude].sort(),
        mustNotInclude: [...testCase.mustNotInclude].sort(),
        shouldRefuse: testCase.shouldRefuse,
        weight: testCase.weight,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Parse a dataset, reporting *every* validation problem at once with the path
 * to the offending field. Datasets are hand-edited by domain experts, not
 * engineers; "cases[7].keyPoints: Required" beats a stack trace.
 */
export function parseDataset(raw: unknown): Dataset {
  const parsed = Dataset.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid dataset:\n${issues}`);
  }
  return parsed.data;
}

export function parseWorkflow(raw: unknown, source: string): Workflow {
  const parsed = Workflow.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid workflow in ${source}:\n${issues}`);
  }
  return parsed.data;
}

export function loadDatasetBundle(datasetId: string, root = examplesDir()): DatasetBundle {
  const dir = path.join(root, datasetId);
  const datasetFile = path.join(dir, 'dataset.json');
  if (!fs.existsSync(datasetFile)) {
    throw new Error(`Dataset "${datasetId}" not found at ${datasetFile}`);
  }

  const dataset = parseDataset(readJson(datasetFile));
  const workflowDir = path.join(dir, 'workflows');
  const workflows = fs.existsSync(workflowDir)
    ? fs
        .readdirSync(workflowDir)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => parseWorkflow(readJson(path.join(workflowDir, file)), file))
    : [];

  return { dataset, hash: hashDataset(dataset), workflows, fixturesDir: path.join(dir, 'fixtures'), dir };
}

export function listDatasetIds(root = examplesDir()): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'dataset.json')))
    .map((entry) => entry.name)
    .sort();
}

export function findWorkflow(bundle: DatasetBundle, versionOrKey: string): Workflow {
  const match = bundle.workflows.find(
    (workflow) => workflow.version === versionOrKey || `${workflow.id}@${workflow.version}` === versionOrKey,
  );
  if (!match) {
    const available = bundle.workflows.map((workflow) => workflow.version).join(', ') || 'none';
    throw new Error(`Workflow "${versionOrKey}" not found in dataset "${bundle.dataset.id}". Available: ${available}`);
  }
  return match;
}
