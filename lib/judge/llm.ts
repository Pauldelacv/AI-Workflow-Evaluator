import { z } from 'zod';
import type { LLMProvider } from '../providers/types';
import { HeuristicJudge } from './heuristic';
import type { Judge, JudgeInput, JudgeVerdict } from './types';

const JUDGE_SYSTEM = `You grade customer-support answers against a reference answer.

Grade only what is asked. Do not rewrite the answer, do not add advice.

Return ONLY a JSON object with this exact shape:
{
  "semantic_score": <number between 0 and 1>,
  "key_points": [{"key_point": "<verbatim key point>", "covered": <true|false>}],
  "contradictions": ["<short description>"],
  "rationale": "<one sentence, max 200 characters>"
}

Rules:
- semantic_score reflects whether the answer conveys the same policy outcome as
  the reference answer. Wording may differ. A vague answer that omits the
  decisive fact is not equivalent.
- A concrete value that differs from the reference (a different number of days,
  a different price) is a contradiction and must cap semantic_score at 0.3.
- Include one entry in key_points for every key point given, in order.`;

const JudgeResponse = z.object({
  semantic_score: z.number().min(0).max(1),
  key_points: z.array(z.object({ key_point: z.string(), covered: z.boolean() })),
  contradictions: z.array(z.string()).default([]),
  rationale: z.string().default(''),
});

export interface LlmJudgeOptions {
  provider: LLMProvider;
  model: string;
  /** Falls back to this judge when the model output cannot be parsed. */
  fallback?: Judge;
  maxOutputTokens?: number;
}

/**
 * LLM-as-judge.
 *
 * Two deliberate constraints:
 *  1. It talks to the same `LLMProvider` interface as the workflow, so a judge
 *     can be pointed at a different model than the workflow under test - which
 *     you want, since a model is a lenient grader of its own output.
 *  2. It always degrades to the heuristic judge rather than throwing. A judge
 *     outage should not destroy an evaluation run; it should be visible in the
 *     results as a degraded case.
 */
export class LlmJudge implements Judge {
  readonly id = 'llm';

  private readonly fallback: Judge;

  constructor(private readonly options: LlmJudgeOptions) {
    this.fallback = options.fallback ?? new HeuristicJudge();
  }

  async judge(input: JudgeInput): Promise<JudgeVerdict> {
    const user = [
      `QUESTION:\n${input.input}`,
      `REFERENCE ANSWER:\n${input.expected}`,
      `ANSWER UNDER TEST:\n${input.actual}`,
      `KEY POINTS:\n${input.keyPoints.map((point, index) => `${index + 1}. ${point}`).join('\n')}`,
    ].join('\n\n');

    try {
      const result = await this.options.provider.complete({
        model: this.options.model,
        system: JUDGE_SYSTEM,
        user,
        maxOutputTokens: this.options.maxOutputTokens ?? 1024,
      });
      return this.parse(result.text, input);
    } catch (error) {
      return this.degrade(input, error instanceof Error ? error.message : 'judge call failed');
    }
  }

  private parse(text: string, input: JudgeInput): JudgeVerdict {
    const json = extractJsonObject(text);
    if (!json) return this.degrade(input, 'judge returned no JSON object');

    const parsed = JudgeResponse.safeParse(json);
    if (!parsed.success) return this.degrade(input, `judge JSON did not validate: ${parsed.error.message}`);

    // Trust the model's verdicts but not its bookkeeping: align key points by
    // position against the ones we asked about, so a dropped or invented entry
    // cannot silently change the completeness denominator.
    const keyPointHits = input.keyPoints.map((keyPoint, index) => ({
      keyPoint,
      covered: parsed.data.key_points[index]?.covered ?? false,
      confidence: parsed.data.key_points[index] ? 1 : 0,
    }));

    return {
      judgeId: this.id,
      semanticScore: parsed.data.semantic_score,
      keyPointHits,
      rationale: parsed.data.rationale.slice(0, 300),
      contradictions: parsed.data.contradictions,
      degraded: false,
    };
  }

  private degrade(input: JudgeInput, reason: string): JudgeVerdict {
    const verdict = new HeuristicJudge().judgeSync(input);
    return {
      ...verdict,
      judgeId: `${this.id}->${this.fallback.id}`,
      rationale: `LLM judge unavailable (${reason}); heuristic fallback: ${verdict.rationale}`,
      degraded: true,
    };
  }
}

/** Pull the first balanced top-level JSON object out of a model response. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
