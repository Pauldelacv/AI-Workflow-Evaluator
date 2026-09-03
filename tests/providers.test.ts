import { describe, expect, it } from 'vitest';
import { MockProvider, createProvider, isProviderId, loadFixtures } from '../lib/providers';
import { ProviderError } from '../lib/providers/types';
import { loadDatasetBundle } from '../lib/datasets';

const fixtures = { 'wf@v1::case-001': { text: 'Recorded answer.', latencyMs: 900 } };

describe('MockProvider', () => {
  const provider = new MockProvider(fixtures);
  const request = {
    model: 'claude-sonnet-5',
    system: 'You are helpful.',
    user: 'Hello?',
    maxOutputTokens: 400,
    fixtureKey: 'wf@v1::case-001',
  };

  it('replays the recorded response and latency', async () => {
    const result = await provider.complete(request);
    expect(result.text).toBe('Recorded answer.');
    expect(result.latencyMs).toBe(900);
    expect(result.simulated).toBe(true);
  });

  it('is byte-for-byte deterministic', async () => {
    expect(await provider.complete(request)).toEqual(await provider.complete(request));
  });

  it('derives input tokens from the rendered prompt, so a longer prompt really costs more', async () => {
    const short = await provider.complete(request);
    const long = await provider.complete({ ...request, system: 'You are helpful. '.repeat(100) });
    expect(long.usage.inputTokens).toBeGreaterThan(short.usage.inputTokens);
    expect(long.usage.estimated).toBe(true);
  });

  it('fails loudly on a missing recording rather than returning an empty answer', async () => {
    // A silently empty answer would score as a legitimate failure and quietly
    // corrupt the run.
    await expect(provider.complete({ ...request, fixtureKey: 'wf@v1::case-999' })).rejects.toThrow(ProviderError);
    await expect(provider.complete({ ...request, fixtureKey: undefined })).rejects.toThrow(/fixtureKey/);
  });

  it('reports that it cannot make real calls, so runs can be labelled honestly', () => {
    expect(provider.supportsRealCalls).toBe(false);
  });
});

describe('provider factory', () => {
  it('validates provider ids', () => {
    expect(isProviderId('mock')).toBe(true);
    expect(isProviderId('gpt')).toBe(false);
  });

  it('refuses to build a mock provider without fixtures', () => {
    expect(() => createProvider('mock')).toThrow(/fixtures directory/);
  });
});

describe('shipped fixtures', () => {
  it('cover every case for every workflow version', () => {
    const bundle = loadDatasetBundle('acme-support');
    const fixtureSet = loadFixtures(bundle.fixturesDir);
    const missing: string[] = [];
    for (const workflow of bundle.workflows) {
      for (const testCase of bundle.dataset.cases) {
        const key = `${workflow.id}@${workflow.version}::${testCase.id}`;
        if (!fixtureSet[key]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });
});
