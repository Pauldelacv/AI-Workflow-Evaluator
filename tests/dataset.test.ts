import { describe, expect, it } from 'vitest';
import { hashDataset, listDatasetIds, loadDatasetBundle, parseDataset, parseWorkflow } from '../lib/datasets';

const validCase = {
  id: 'case-001',
  input: 'How long is the trial?',
  expected: 'The trial lasts 14 days.',
  category: 'straightforward',
  keyPoints: ['the trial lasts 14 days'],
};

const validDataset = {
  id: 'demo',
  name: 'Demo',
  knowledgeBase: [{ id: 'kb-1', title: 'Trial', text: 'The trial lasts 14 days.', keywords: ['trial'] }],
  cases: [validCase],
};

describe('parseDataset', () => {
  it('accepts a minimal dataset and fills defaults', () => {
    const dataset = parseDataset(validDataset);
    expect(dataset.cases[0]?.mustInclude).toEqual([]);
    expect(dataset.cases[0]?.shouldRefuse).toBe(false);
    expect(dataset.cases[0]?.weight).toBe(1);
  });

  it('rejects duplicate case ids, naming the offending path', () => {
    expect(() => parseDataset({ ...validDataset, cases: [validCase, validCase] })).toThrow(/Duplicate case id "case-001"/);
  });

  it('rejects a grounding reference to a knowledge snippet that does not exist', () => {
    expect(() =>
      parseDataset({ ...validDataset, cases: [{ ...validCase, groundingRefs: ['kb-missing'] }] }),
    ).toThrow(/unknown knowledge snippet "kb-missing"/);
  });

  it('rejects a case with no key points, because completeness would be meaningless', () => {
    expect(() => parseDataset({ ...validDataset, cases: [{ ...validCase, keyPoints: [] }] })).toThrow(/keyPoints/);
  });

  it('rejects an unknown category rather than silently bucketing it', () => {
    expect(() => parseDataset({ ...validDataset, cases: [{ ...validCase, category: 'vibes' }] })).toThrow(/category/);
  });

  it('rejects unknown top-level fields, so a typo is not silently ignored', () => {
    expect(() => parseDataset({ ...validDataset, casses: [] })).toThrow();
  });

  it('rejects a dataset with no cases', () => {
    expect(() => parseDataset({ ...validDataset, cases: [] })).toThrow();
  });
});

describe('parseWorkflow', () => {
  const workflow = {
    id: 'support-agent',
    version: 'v1',
    model: 'claude-sonnet-5',
    systemPrompt: 'Be helpful.',
    retrieval: 'keyword',
  };

  it('accepts a valid workflow and defaults retrievalTopK', () => {
    expect(parseWorkflow(workflow, 'w.json').retrievalTopK).toBe(3);
  });

  it('rejects an unknown retrieval strategy', () => {
    expect(() => parseWorkflow({ ...workflow, retrieval: 'vector-magic' }, 'w.json')).toThrow(/w\.json/);
  });
});

describe('hashDataset', () => {
  it('is stable across key ordering and cosmetic field order', () => {
    const a = parseDataset(validDataset);
    const b = parseDataset({ ...validDataset, description: 'different prose, same cases' });
    expect(hashDataset(a)).toBe(hashDataset(b));
  });

  it('changes when a case changes, so incomparable runs can be detected', () => {
    const a = parseDataset(validDataset);
    const b = parseDataset({ ...validDataset, cases: [{ ...validCase, expected: 'The trial lasts 30 days.' }] });
    expect(hashDataset(a)).not.toBe(hashDataset(b));
  });
});

describe('the shipped acme-support dataset', () => {
  it('is discoverable and valid', () => {
    expect(listDatasetIds()).toContain('acme-support');
    const bundle = loadDatasetBundle('acme-support');
    expect(bundle.dataset.cases).toHaveLength(30);
    expect(bundle.workflows.map((w) => w.version).sort()).toEqual([
      'v1-baseline',
      'v2-grounded',
      'v3-cost-optimised',
    ]);
  });

  it('covers every case category, so failures can be sliced by kind', () => {
    const categories = new Set(loadDatasetBundle('acme-support').dataset.cases.map((c) => c.category));
    expect(categories).toEqual(
      new Set([
        'straightforward', 'ambiguous', 'edge-case', 'policy',
        'out-of-scope', 'adversarial', 'hallucination-bait', 'precision',
      ]),
    );
  });

  it('throws a readable error for a dataset that does not exist', () => {
    expect(() => loadDatasetBundle('no-such-dataset')).toThrow(/not found/);
  });
});
