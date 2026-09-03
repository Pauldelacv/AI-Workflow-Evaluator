import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RunStore } from '../lib/runs/store';
import type { CaseResult, Run } from '../lib/types';

let tempDir: string;
let store: RunStore;

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'awe-store-'));
  store = new RunStore(tempDir);
});

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

function caseResult(caseId: string, passed: boolean): CaseResult {
  return {
    caseId, category: 'policy', weight: 1, input: 'i', expected: 'e', actual: 'a', retrievedRefs: [],
    latencyMs: 1000, usage: { inputTokens: 10, outputTokens: 10, estimated: true }, costUsd: 0.001,
    scores: {
      correctness: { score: passed ? 1 : 0.2, rationale: 'r', details: {} },
      groundedness: { score: 1, rationale: 'r', details: {} },
      completeness: { score: passed ? 1 : 0.5, rationale: 'r', details: {} },
      overall: passed ? 1 : 0.4,
    },
    passed, failureReasons: passed ? [] : ['below threshold'],
  };
}

function makeRun(id: string, createdAt: string, results: CaseResult[] = [caseResult('case-001', true)]): Run {
  return {
    id, label: `support-agent@${id}`, createdAt,
    datasetId: 'demo', datasetName: 'Demo', datasetHash: 'hash-1',
    workflowId: 'support-agent', workflowVersion: id,
    config: {
      weights: { correctness: 0.5, groundedness: 0.25, completeness: 0.25 },
      passThreshold: 0.7, providerId: 'mock', judgeId: 'heuristic', seed: 42,
    },
    results,
    summary: {
      totalCases: results.length, passedCases: results.filter((r) => r.passed).length,
      failedCases: results.filter((r) => !r.passed).length, erroredCases: 0, reviewedCases: 0,
      passRate: 1, correctness: 1, groundedness: 1, completeness: 1, overall: 1,
      meanLatencyMs: 1000, p95LatencyMs: 1000, totalCostUsd: 0.001, meanCostUsd: 0.001, byCategory: {},
    },
    durationMs: 100, notes: '',
  };
}

describe('RunStore', () => {
  it('round-trips a run through disk without loss', async () => {
    const run = makeRun('r1', '2026-01-01T00:00:00.000Z');
    await store.save(run);
    expect(await store.get('r1')).toEqual(run);
  });

  it('returns null for a run that does not exist, and throws on require', async () => {
    expect(await store.get('nope')).toBeNull();
    await expect(store.require('nope')).rejects.toThrow(/not found/);
  });

  it('lists runs newest first and filters by dataset', async () => {
    await store.save(makeRun('r1', '2026-01-01T00:00:00.000Z'));
    await store.save(makeRun('r2', '2026-01-02T00:00:00.000Z'));
    expect((await store.list()).map((entry) => entry.id)).toEqual(['r2', 'r1']);
    expect(await store.list({ datasetId: 'other' })).toEqual([]);
  });

  it('picks the most recent run as the implicit baseline, excluding the current one', async () => {
    await store.save(makeRun('r1', '2026-01-01T00:00:00.000Z'));
    await store.save(makeRun('r2', '2026-01-02T00:00:00.000Z'));
    expect((await store.latestFor('demo', undefined, 'r2'))?.id).toBe('r1');
  });

  it('rejects a run id that would escape the runs directory', async () => {
    // The store is reachable from an HTTP route, so this is a real boundary.
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/Invalid run id/);
    await expect(store.delete('..%2Fescape')).rejects.toThrow(/Invalid run id/);
  });

  it('leaves no temporary files behind after a save', async () => {
    await store.save(makeRun('r1', '2026-01-01T00:00:00.000Z'));
    const files = fs.readdirSync(path.join(tempDir, 'runs'));
    expect(files).toEqual(['r1.json']);
  });

  it('rejects a stored run that no longer matches the schema', async () => {
    await store.ensureDir();
    await fsp.writeFile(path.join(tempDir, 'runs', 'bad.json'), JSON.stringify({ id: 'bad' }), 'utf8');
    await expect(store.get('bad')).rejects.toThrow(/does not match the current schema/);
  });

  describe('human review', () => {
    it('records a verdict beside the automated score without overwriting it', async () => {
      await store.save(makeRun('r1', '2026-01-01T00:00:00.000Z', [caseResult('case-001', false)]));
      const updated = await store.review('r1', 'case-001', {
        verdict: 'accept', comment: 'Technically right, tone is off.', reviewer: 'paul',
        reviewedAt: '2026-01-03T00:00:00.000Z',
      });

      const result = updated.results[0]!;
      expect(result.passed).toBe(false); // the model's verdict is preserved
      expect(result.review?.verdict).toBe('accept');
      expect(updated.summary.passRate).toBe(1); // the effective verdict drives the summary
      expect(updated.summary.reviewedCases).toBe(1);
    });

    it('recomputes the summary when a review is cleared', async () => {
      await store.save(makeRun('r1', '2026-01-01T00:00:00.000Z', [caseResult('case-001', false)]));
      await store.review('r1', 'case-001', { verdict: 'accept', comment: '', reviewer: 'paul', reviewedAt: '2026-01-03T00:00:00.000Z' });
      const cleared = await store.review('r1', 'case-001', null);
      expect(cleared.results[0]?.review).toBeUndefined();
      expect(cleared.summary.passRate).toBe(0);
    });

    it('can reject a case the automation passed', async () => {
      await store.save(makeRun('r1', '2026-01-01T00:00:00.000Z', [caseResult('case-001', true)]));
      const updated = await store.review('r1', 'case-001', { verdict: 'reject', comment: 'Invented a roadmap claim.', reviewer: 'paul', reviewedAt: '2026-01-03T00:00:00.000Z' });
      expect(updated.summary.passRate).toBe(0);
    });

    it('rejects a review for a case that is not in the run', async () => {
      await store.save(makeRun('r1', '2026-01-01T00:00:00.000Z'));
      await expect(
        store.review('r1', 'case-999', { verdict: 'accept', comment: '', reviewer: 'p', reviewedAt: '2026-01-03T00:00:00.000Z' }),
      ).rejects.toThrow(/not found in run/);
    });
  });
});
