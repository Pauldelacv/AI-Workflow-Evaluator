import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMRequest, LLMResult } from './types';
import { ProviderError } from './types';

export interface AnthropicProviderOptions {
  apiKey?: string;
  /**
   * Reasoning depth. `low` is the right default for both support answers and
   * judging: both are short, well-specified tasks where extra thinking mostly
   * buys latency and cost.
   */
  effort?: 'low' | 'medium' | 'high';
  maxRetries?: number;
  timeoutMs?: number;
}

/**
 * Real provider. Optional: the whole project runs without it.
 *
 * Note what is *not* here - temperature, top_p, top_k. Current Claude models
 * reject sampling parameters with a 400, so run-to-run variation is handled by
 * running the eval more than once rather than by pinning a temperature.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly supportsRealCalls = true;

  private readonly client: Anthropic;
  private readonly effort: 'low' | 'medium' | 'high';

  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ProviderError(
        'ANTHROPIC_API_KEY is not set. Use the mock provider (--provider mock) to run offline.',
        'anthropic',
        false,
      );
    }
    this.client = new Anthropic({
      apiKey,
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeoutMs ?? 60_000,
    });
    this.effort = options.effort ?? 'low';
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const startedAt = Date.now();
    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: { effort: this.effort },
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      if (response.stop_reason === 'refusal') {
        throw new ProviderError(
          `Model declined the request (${response.stop_details?.explanation ?? 'no explanation'})`,
          this.id,
          false,
        );
      }

      return {
        text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          estimated: false,
        },
        latencyMs: Date.now() - startedAt,
        model: response.model,
        simulated: false,
      };
    } catch (error) {
      throw toProviderError(error, this.id);
    }
  }
}

/**
 * Map SDK errors onto a retryable / non-retryable split. Most-specific first;
 * `APIConnectionError` is a subclass of `APIError` in the TypeScript SDK, so it
 * has to be checked before the base class.
 */
function toProviderError(error: unknown, providerId: string): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError('Rate limited by the Anthropic API', providerId, true, { cause: error });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError('Anthropic API rejected the credentials', providerId, false, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Could not reach the Anthropic API', providerId, true, { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    const retryable = typeof error.status === 'number' && error.status >= 500;
    return new ProviderError(`Anthropic API error: ${error.message}`, providerId, retryable, { cause: error });
  }
  return new ProviderError(
    error instanceof Error ? error.message : 'Unknown provider failure',
    providerId,
    false,
    { cause: error },
  );
}
