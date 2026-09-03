import { estimateTokens } from '../cost';
import type { LLMProvider, LLMRequest, LLMResult } from './types';
import { ProviderError } from './types';

export interface FixtureResponse {
  text: string;
  /** Latency recorded when the fixture was captured, replayed verbatim. */
  latencyMs: number;
}

export type FixtureSet = Record<string, FixtureResponse>;

/**
 * Deterministic provider backed by recorded responses.
 *
 * Why this exists:
 *  - CI runs the full evaluation with no API key and no network.
 *  - Scoring changes can be reviewed against a frozen set of model outputs, so
 *    a metric delta means the metric changed, not the model.
 *  - Contributors can run the demo in 5 minutes.
 *
 * Fixtures are keyed by `<workflow>@<version>::<caseId>`. A missing key is a
 * hard error, never a silently empty answer - a silently empty answer would
 * score as a legitimate failure and quietly corrupt a run.
 */
export class MockProvider implements LLMProvider {
  readonly id = 'mock';
  readonly supportsRealCalls = false;

  constructor(private readonly fixtures: FixtureSet) {}

  async complete(request: LLMRequest): Promise<LLMResult> {
    const key = request.fixtureKey;
    if (!key) {
      throw new ProviderError('MockProvider requires a fixtureKey', this.id, false);
    }

    const fixture = this.fixtures[key];
    if (!fixture) {
      throw new ProviderError(
        `No recorded response for "${key}". Record it with \`npm run eval -- record\` or add it to the fixture file.`,
        this.id,
        false,
      );
    }

    // Input tokens are derived from the prompt that was actually rendered, so a
    // longer system prompt or more retrieved context genuinely costs more.
    const inputTokens = estimateTokens(request.system) + estimateTokens(request.user);

    return {
      text: fixture.text,
      usage: {
        inputTokens,
        outputTokens: estimateTokens(fixture.text),
        estimated: true,
      },
      latencyMs: fixture.latencyMs,
      model: request.model,
      simulated: true,
    };
  }
}
