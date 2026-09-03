import { z } from 'zod';
import { DEFAULT_RUN_CONFIG } from './config';
import { findWorkflow, loadDatasetBundle } from './datasets';
import { runEvaluation } from './evaluator';
import { createJudge, isJudgeId } from './judge';
import { createProvider, isProviderId } from './providers';
import { runStore } from './runs/store';
import { HumanReview, type Run } from './types';

/**
 * Request handling shared by the API routes.
 *
 * These functions are plain async functions over plain objects, not Next.js
 * handlers, so they can be unit tested without constructing a Request. The
 * route files stay thin adapters.
 */

export const CreateRunRequest = z.object({
  datasetId: z.string().min(1),
  workflowVersion: z.string().min(1),
  provider: z.string().default('mock'),
  judge: z.string().default('heuristic'),
  judgeModel: z.string().default('claude-opus-5'),
  concurrency: z.number().int().positive().max(16).default(4),
  notes: z.string().default(''),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export const ReviewRequest = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  review: HumanReview.omit({ reviewedAt: true }).nullable(),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

/** Error carrying the HTTP status the route should return. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function createRun(input: CreateRunRequest): Promise<Run> {
  if (!isProviderId(input.provider)) throw new ApiError(`Unknown provider "${input.provider}"`, 400);
  if (!isJudgeId(input.judge)) throw new ApiError(`Unknown judge "${input.judge}"`, 400);

  let bundle;
  try {
    bundle = loadDatasetBundle(input.datasetId);
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : 'Dataset could not be loaded', 404);
  }

  let workflow;
  try {
    workflow = findWorkflow(bundle, input.workflowVersion);
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : 'Workflow not found', 404);
  }

  const provider = createProvider(input.provider, { fixturesDir: bundle.fixturesDir });
  const judge = createJudge(input.judge, { provider, model: input.judgeModel });

  const run = await runEvaluation({
    bundle,
    workflow,
    provider,
    judge,
    config: DEFAULT_RUN_CONFIG,
    concurrency: input.concurrency,
    notes: input.notes,
  });

  return runStore.save(run);
}

export async function applyReview(input: ReviewRequest): Promise<Run> {
  try {
    return await runStore.review(
      input.runId,
      input.caseId,
      input.review === null ? null : HumanReview.parse({ ...input.review, reviewedAt: new Date().toISOString() }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Review failed';
    throw new ApiError(message, /not found/.test(message) ? 404 : 400);
  }
}

/** Parse an unknown JSON body against a schema, reporting field paths on failure. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ApiError(`Invalid request body - ${detail}`, 400);
  }
  return parsed.data;
}
