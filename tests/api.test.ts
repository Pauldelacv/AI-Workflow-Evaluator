import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The API layer writes through the shared run store, which resolves its
// directory from AWE_DATA_DIR at call time. Point it at a temp dir before the
// module graph is imported.
const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'awe-api-'));
process.env.AWE_DATA_DIR = tempDir;

const { ApiError, CreateRunRequest, ReviewRequest, applyReview, createRun, parseBody } = await import('../lib/api');
const { runStore } = await import('../lib/runs/store');

let runId: string;

beforeAll(async () => {
  const run = await createRun(
    parseBody(CreateRunRequest, { datasetId: 'acme-support', workflowVersion: 'v2-grounded' }),
  );
  runId = run.id;
});

afterAll(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

describe('parseBody', () => {
  it('applies defaults for optional fields', () => {
    const parsed = parseBody(CreateRunRequest, { datasetId: 'acme-support', workflowVersion: 'v1-baseline' });
    expect(parsed.provider).toBe('mock');
    expect(parsed.judge).toBe('heuristic');
    expect(parsed.concurrency).toBe(4);
  });

  it('reports the offending field path on invalid input', () => {
    expect(() => parseBody(CreateRunRequest, { datasetId: 'acme-support' })).toThrow(/workflowVersion/);
    expect(() => parseBody(CreateRunRequest, {})).toThrow(ApiError);
  });

  it('rejects an out-of-range concurrency instead of hammering a provider', () => {
    expect(() => parseBody(CreateRunRequest, { datasetId: 'a', workflowVersion: 'b', concurrency: 500 })).toThrow();
  });
});

describe('createRun', () => {
  it('runs the evaluation and persists it', async () => {
    const stored = await runStore.get(runId);
    expect(stored?.summary.totalCases).toBe(30);
    expect(stored?.workflowVersion).toBe('v2-grounded');
  });

  it('returns 404 for an unknown dataset', async () => {
    await expect(
      createRun(parseBody(CreateRunRequest, { datasetId: 'nope', workflowVersion: 'v1-baseline' })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 404 for an unknown workflow version', async () => {
    await expect(
      createRun(parseBody(CreateRunRequest, { datasetId: 'acme-support', workflowVersion: 'v9' })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 400 for an unknown provider', async () => {
    await expect(
      createRun(parseBody(CreateRunRequest, { datasetId: 'acme-support', workflowVersion: 'v2-grounded', provider: 'gpt' })),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('applyReview', () => {
  it('stores a human verdict and recomputes the summary', async () => {
    const before = await runStore.require(runId);
    const failing = before.results.find((result) => !result.passed)!;

    const updated = await applyReview(
      parseBody(ReviewRequest, {
        runId,
        caseId: failing.caseId,
        review: { verdict: 'accept', comment: 'Declining is correct here.', reviewer: 'paul' },
      }),
    );

    const reviewed = updated.results.find((result) => result.caseId === failing.caseId)!;
    expect(reviewed.review?.verdict).toBe('accept');
    expect(reviewed.review?.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(reviewed.passed).toBe(false); // automated verdict untouched
    expect(updated.summary.passedCases).toBe(before.summary.passedCases + 1);
  });

  it('clears an override when review is null', async () => {
    const current = await runStore.require(runId);
    const reviewed = current.results.find((result) => result.review)!;
    const updated = await applyReview(parseBody(ReviewRequest, { runId, caseId: reviewed.caseId, review: null }));
    expect(updated.results.find((r) => r.caseId === reviewed.caseId)?.review).toBeUndefined();
  });

  it('returns 404 for a case that is not in the run', async () => {
    await expect(
      applyReview(
        parseBody(ReviewRequest, { runId, caseId: 'case-999', review: { verdict: 'accept', comment: '', reviewer: 'p' } }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an invalid verdict', () => {
    expect(() =>
      parseBody(ReviewRequest, { runId, caseId: 'case-001', review: { verdict: 'maybe', comment: '', reviewer: 'p' } }),
    ).toThrow(/verdict/);
  });
});
