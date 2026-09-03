import fs from 'node:fs';
import path from 'node:path';
import { AnthropicProvider } from './anthropic';
import { MockProvider, type FixtureSet } from './mock';
import type { LLMProvider } from './types';
import { ProviderError } from './types';

export type ProviderId = 'mock' | 'anthropic';

export const PROVIDER_IDS: readonly ProviderId[] = ['mock', 'anthropic'] as const;

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Load every `*.json` fixture file in a directory and merge it into one map.
 * One file per workflow version keeps diffs readable when a prompt changes.
 */
export function loadFixtures(dir: string): FixtureSet {
  if (!fs.existsSync(dir)) return {};
  const fixtures: FixtureSet = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Fixture file ${file} is not a JSON object`);
    }
    Object.assign(fixtures, parsed as FixtureSet);
  }
  return fixtures;
}

export interface CreateProviderOptions {
  fixturesDir?: string;
}

export function createProvider(id: ProviderId, options: CreateProviderOptions = {}): LLMProvider {
  switch (id) {
    case 'mock': {
      if (!options.fixturesDir) {
        throw new ProviderError('The mock provider needs a fixtures directory', 'mock', false);
      }
      return new MockProvider(loadFixtures(options.fixturesDir));
    }
    case 'anthropic':
      return new AnthropicProvider();
  }
}

export { AnthropicProvider, MockProvider, ProviderError };
export type { FixtureSet } from './mock';
export type { LLMProvider, LLMRequest, LLMResult } from './types';
