import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../config';
import { HumanReview, Run } from '../types';
import type { CaseResult, HumanReview as HumanReviewType, Run as RunType } from '../types';
import { summarise } from '../evaluator';

/**
 * Runs are stored as one JSON document per run under `.data/runs/`.
 *
 * Why not SQLite: a run is written once, read whole, and never queried by
 * field. At the scale this tool targets (hundreds of runs, tens of cases each)
 * a directory of JSON files is faster to reason about, trivially diffable, and
 * copies between machines with `scp`. If runs ever need cross-run querying,
 * this module is the only thing that changes.
 */

export interface RunIndexEntry {
  id: string;
  label: string;
  createdAt: string;
  datasetId: string;
  datasetHash: string;
  workflowId: string;
  workflowVersion: string;
  providerId: string;
  overall: number;
  passRate: number;
  meanLatencyMs: number;
  meanCostUsd: number;
  totalCases: number;
}

export class RunStore {
  /**
   * Resolved lazily rather than in the constructor. The shared instance below
   * is created at module load, and `AWE_DATA_DIR` is often set after that (by
   * a test, or by a process that configures its environment late). Reading it
   * per call costs nothing and removes a genuinely confusing footgun.
   */
  private get runsDir(): string {
    return path.join(this.root ?? dataDir(), 'runs');
  }

  constructor(private readonly root?: string) {}

  private file(runId: string): string {
    // Run ids come from our own generator, but this store is also reachable
    // from an HTTP route - never let one escape the runs directory.
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error(`Invalid run id: ${runId}`);
    return path.join(this.runsDir, `${runId}.json`);
  }

  async ensureDir(): Promise<void> {
    await fsp.mkdir(this.runsDir, { recursive: true });
  }

  /** Write atomically: a half-written run file would poison every later read. */
  async save(run: RunType): Promise<RunType> {
    await this.ensureDir();
    const target = this.file(run.id);
    const temp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
    await fsp.rename(temp, target);
    return run;
  }

  async get(runId: string): Promise<RunType | null> {
    try {
      const raw: unknown = JSON.parse(await fsp.readFile(this.file(runId), 'utf8'));
      const parsed = Run.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`Stored run ${runId} does not match the current schema: ${parsed.error.message}`);
      }
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async require(runId: string): Promise<RunType> {
    const run = await this.get(runId);
    if (!run) throw new Error(`Run "${runId}" not found`);
    return run;
  }

  /** Newest first. Reads every run file; fine at this scale, and keeps one source of truth. */
  async list(options: { datasetId?: string; workflowId?: string; limit?: number } = {}): Promise<RunIndexEntry[]> {
    if (!fs.existsSync(this.runsDir)) return [];
    const files = (await fsp.readdir(this.runsDir)).filter((file) => file.endsWith('.json'));

    const entries: RunIndexEntry[] = [];
    for (const file of files) {
      const run = await this.get(path.basename(file, '.json'));
      if (!run) continue;
      if (options.datasetId && run.datasetId !== options.datasetId) continue;
      if (options.workflowId && run.workflowId !== options.workflowId) continue;
      entries.push({
        id: run.id,
        label: run.label,
        createdAt: run.createdAt,
        datasetId: run.datasetId,
        datasetHash: run.datasetHash,
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        providerId: run.config.providerId,
        overall: run.summary.overall,
        passRate: run.summary.passRate,
        meanLatencyMs: run.summary.meanLatencyMs,
        meanCostUsd: run.summary.meanCostUsd,
        totalCases: run.summary.totalCases,
      });
    }

    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return options.limit ? entries.slice(0, options.limit) : entries;
  }

  /** Most recent run for a workflow - the implicit baseline when none is named. */
  async latestFor(datasetId: string, workflowId?: string, excludeRunId?: string): Promise<RunIndexEntry | null> {
    const entries = await this.list({ datasetId, workflowId });
    return entries.find((entry) => entry.id !== excludeRunId) ?? null;
  }

  /**
   * Record (or clear) a human verdict on one case.
   *
   * The automated scores are never mutated - the override lives beside them, so
   * "the model said 0.42, a human accepted it anyway" stays visible forever.
   * The run summary is recomputed because pass rate is what gates a deploy.
   */
  async review(runId: string, caseId: string, review: HumanReviewType | null): Promise<RunType> {
    const run = await this.require(runId);
    const index = run.results.findIndex((result) => result.caseId === caseId);
    if (index === -1) throw new Error(`Case "${caseId}" not found in run "${runId}"`);

    const existing = run.results[index] as CaseResult;
    const updated: CaseResult = { ...existing };
    if (review) {
      updated.review = HumanReview.parse(review);
    } else {
      delete updated.review;
    }

    const results = [...run.results];
    results[index] = updated;
    return this.save({ ...run, results, summary: summarise(results) });
  }

  async delete(runId: string): Promise<boolean> {
    try {
      await fsp.unlink(this.file(runId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

/** Shared instance for the app. Tests construct their own against a temp dir. */
export const runStore = new RunStore();
