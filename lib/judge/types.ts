export interface JudgeInput {
  input: string;
  expected: string;
  actual: string;
  keyPoints: string[];
}

export interface KeyPointHit {
  keyPoint: string;
  covered: boolean;
  /** 0..1 evidence strength, used to explain borderline calls. */
  confidence: number;
}

export interface JudgeVerdict {
  judgeId: string;
  /** How well the answer agrees with the reference answer, 0..1. */
  semanticScore: number;
  keyPointHits: KeyPointHit[];
  rationale: string;
  /** Claims in `expected` that the answer contradicts (e.g. "30 days" vs "60 days"). */
  contradictions: string[];
  /** True when an LLM judge failed and the heuristic judge answered instead. */
  degraded: boolean;
}

/**
 * Judging is pluggable for one reason: LLM-as-judge is useful but not free and
 * not deterministic. The heuristic judge keeps CI honest and offline; the LLM
 * judge is the semantic upgrade for real evaluation sessions.
 */
export interface Judge {
  readonly id: string;
  judge(input: JudgeInput): Promise<JudgeVerdict>;
}
