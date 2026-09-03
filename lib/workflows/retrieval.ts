import { tokenSet } from '../text';
import type { EvalCase, KnowledgeSnippet, Workflow } from '../types';

export interface RetrievalResult {
  snippets: KnowledgeSnippet[];
  /** Human-readable explanation of why these snippets were selected. */
  strategy: string;
}

/**
 * Deliberately naive keyword retrieval: score each snippet by keyword hits in
 * the question, break ties by content-token overlap, take the top K.
 *
 * It is not a vector store and does not need to be. The point of this project
 * is the evaluation loop, and a transparent retriever makes groundedness
 * failures explainable ("the snippet was never retrieved") instead of magical.
 */
export function retrieve(workflow: Workflow, testCase: EvalCase, knowledgeBase: KnowledgeSnippet[]): RetrievalResult {
  if (workflow.retrieval === 'none') {
    return { snippets: [], strategy: 'none (workflow answers from model priors only)' };
  }
  if (workflow.retrieval === 'all') {
    return { snippets: knowledgeBase, strategy: `all (${knowledgeBase.length} snippets)` };
  }

  const questionTokens = tokenSet(testCase.input);
  const scored = knowledgeBase
    .map((snippet) => {
      const keywordHits = snippet.keywords.filter((keyword) =>
        tokenSet(keyword).size === 0 ? false : [...tokenSet(keyword)].every((token) => questionTokens.has(token)),
      ).length;

      const snippetTokens = tokenSet(`${snippet.title} ${snippet.text}`);
      let overlap = 0;
      for (const token of questionTokens) if (snippetTokens.has(token)) overlap += 1;

      return { snippet, score: keywordHits * 10 + overlap };
    })
    .filter((entry) => entry.score > 0)
    // Sort by score, then by id so the result is stable for equal scores.
    .sort((a, b) => b.score - a.score || a.snippet.id.localeCompare(b.snippet.id))
    .slice(0, workflow.retrievalTopK);

  return {
    snippets: scored.map((entry) => entry.snippet),
    strategy: `keyword top-${workflow.retrievalTopK} (matched ${scored.length})`,
  };
}

/** Render retrieved snippets into the prompt block the workflow sees. */
export function renderContext(snippets: KnowledgeSnippet[]): string {
  if (snippets.length === 0) return '';
  return snippets.map((snippet) => `[${snippet.id}] ${snippet.title}\n${snippet.text}`).join('\n\n');
}
