import type { LLMProvider } from '../providers/types';
import { HeuristicJudge } from './heuristic';
import { LlmJudge } from './llm';
import type { Judge } from './types';

export type JudgeId = 'heuristic' | 'llm';

export const JUDGE_IDS: readonly JudgeId[] = ['heuristic', 'llm'] as const;

export function isJudgeId(value: string): value is JudgeId {
  return (JUDGE_IDS as readonly string[]).includes(value);
}

export interface CreateJudgeOptions {
  provider: LLMProvider;
  /** Model used for judging. Keep it distinct from the workflow's model. */
  model: string;
}

export function createJudge(id: JudgeId, options: CreateJudgeOptions): Judge {
  switch (id) {
    case 'heuristic':
      return new HeuristicJudge();
    case 'llm':
      return new LlmJudge({ provider: options.provider, model: options.model });
  }
}

export { HeuristicJudge, LlmJudge };
export type { Judge, JudgeInput, JudgeVerdict, KeyPointHit } from './types';
