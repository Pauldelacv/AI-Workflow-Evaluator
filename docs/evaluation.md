# Evaluation methodology

This document describes exactly how a score is produced, and — more importantly
— what each number does **not** mean. An evaluator that overstates its own
precision is worse than no evaluator, because it converts a guess into a
number someone will put in a slide.

---

## 1. The unit of evaluation

A **case** is one representative business interaction:

```json
{
  "id": "case-003",
  "category": "precision",
  "input": "Can I get a refund after 60 days?",
  "expected": "No. Refunds are only available within 30 days of the initial purchase.",
  "keyPoints": ["refunds only within 30 days of purchase", "no refund is available after 60 days"],
  "mustInclude": ["30 days"],
  "mustNotInclude": ["60-day money-back"],
  "groundingRefs": ["kb-refund"],
  "weight": 2
}
```

Five things are being asserted, and they are deliberately different in kind:

| Field | Kind | Why it exists |
|---|---|---|
| `expected` | Reference answer | What the judge compares against |
| `keyPoints` | Semantic checklist | Drives completeness; produces "what was missing" |
| `mustInclude` | Literal assertion | Deterministic, auditable, never debatable |
| `mustNotInclude` | Literal assertion | Encodes a hallucination you have actually seen |
| `shouldRefuse` | Behavioural assertion | Some questions must not be answered at all |

`mustNotInclude` entries are written *after* observing a failure. That is the
intended workflow: a model invents a "60-day money-back guarantee", you turn
that specific failure into a permanent assertion, and it can never silently
come back. This is regression testing, applied to prompts.

### Case categories

Every case is tagged: `straightforward`, `ambiguous`, `edge-case`, `policy`,
`out-of-scope`, `adversarial`, `hallucination-bait`, `precision`.

"Accuracy dropped 5 points" is not actionable. "Accuracy dropped 5 points and
all of it is in `out-of-scope`" tells you what broke and roughly where to look.

---

## 2. The metrics

### Correctness (weight 0.5)

Does the answer give the customer the right outcome?

```
if shouldRefuse:
    base = declined ? 0.6 + 0.4 * semantic
                    : 0.2 * semantic
elif mustInclude is empty:
    base = semantic
else:
    base = 0.55 * (required facts present) + 0.45 * semantic

correctness = base * (1 - 0.5 * forbidden_hits)      # clamped to [0, 1]
```

Two design choices worth defending:

- **Forbidden content is multiplicative, not subtractive.** An answer that
  invents a phone support line is not "80% correct". It is wrong, and it should
  drag the score toward zero rather than lose a few points.
- **Refusal cases are scored on whether they declined**, not on eloquence. For
  an out-of-scope or adversarial question, a fluent wrong answer is worse than
  no answer. Declining earns a floor of 0.6; answering caps at 0.2.

### Groundedness (weight 0.25)

Is every checkable claim traceable to information the workflow actually had?

A **checkable claim** is a number with a unit or a currency: `30 days`, `€49`,
`99.9%`, `18:00`, `10 seats`. These are what customers act on, and what models
most reliably invent.

```
claims        = extract(answer)
supported     = extract(retrieved context + the customer's own message)
groundedness  = |claims ∩ supported| / |claims|
```

The customer's message counts as grounding: repeating a number the customer
supplied ("you mentioned 45 days") is not a hallucination.

> **Known limitation, by construction.** An answer containing no numbers scores
> **1.0**. Vague answers are perfectly grounded. This is why groundedness is
> never read alone — a hedge that says nothing scores 1.0 here and is punished
> by correctness and completeness instead. The three metrics are a set.

Groundedness is measured against what the workflow *saw*, not against the
knowledge base as a whole. A workflow with no retrieval that happens to emit a
correct number still scores 0 on that claim, because it got the number from
model priors. That is the risk being measured, and it is measured correctly.

### Completeness (weight 0.25)

What fraction of the case's `keyPoints` did the answer actually cover?

A key point counts as covered when ≥60% of its content tokens appear in the
answer, after stop-word removal and light stemming. The rationale names the
missed points verbatim, which is usually the single most useful line in a
failure report.

### Overall

```
overall = 0.5 * correctness + 0.25 * groundedness + 0.25 * completeness
```

A case **passes** when `overall ≥ 0.7` **and** it trips no hard violation.
Hard violations bypass the average entirely:

- the answer contains forbidden content, or
- the case is marked `shouldRefuse` and the answer did not decline.

Some failures must not be averaged away.

### Latency and cost

Latency is measured per call. Cost is `tokens × published list price`, from a
small table in `lib/cost.ts`.

Cost is an **order of magnitude for comparing versions to each other**, not a
billing figure. It ignores prompt caching, batch discounts and negotiated
rates. Token counts from a live provider are exact; counts from recorded
fixtures are estimated locally at ~4 characters per token and flagged
`estimated: true` in the run.

Quality metrics are weighted by `case.weight`; latency and cost are plain
means. Weighting an operational cost by business importance would be nonsense.

---

## 3. The judge

Semantic agreement is the one part that cannot be done with string matching, so
it lives behind an interface with two implementations.

### `HeuristicJudge` (default)

Deterministic, offline, no API key. It combines:

- **token F1** against the reference answer (lexical agreement),
- **claim recall** — the fraction of the reference answer's checkable claims
  the answer reproduces,
- **contradiction detection** — the answer states a different value for the
  same unit ("30 days" vs "90 days"), which caps the score.

```
semantic = (0.5 * tokenF1 + 0.5 * claimRecall) * (1 - 0.5 * contradictionRate)
```

**What it gets wrong:** it under-scores correct paraphrases that share few
tokens with the reference. Irregular verbs ("saw" / "see") defeat the stemmer.
It has no notion of negation beyond token overlap, so "refunds are available
within 30 days" and "refunds are not available within 30 days" score closer
than they should.

It is used by default anyway, because it is **reproducible**. CI needs a number
that does not move unless the workflow moved.

### `LlmJudge` (opt-in)

Sends the question, the reference answer, the answer under test and the key
points to a model, and requires a JSON verdict.

Three deliberate constraints:

1. It talks to the same `LLMProvider` interface as the workflow, so the judge
   can run on a **different model** than the system under test. A model is a
   lenient grader of its own output.
2. Key points are re-aligned by position against the ones that were asked
   about, so a model that drops or invents an entry cannot silently change the
   completeness denominator.
3. It **degrades to the heuristic judge instead of throwing**. A judge outage
   should not destroy a run; it should appear in the results as a degraded
   case, which is what `verdict.degraded` and the failure reason record.

**LLM-as-judge limitations that no amount of prompting fixes:**

- It is not deterministic. Two runs of the same candidate can differ, so a
  small delta between two LLM-judged runs may be judge noise rather than signal.
- It is biased toward fluent, confident answers — exactly the failure mode that
  matters most in customer support.
- It has never been calibrated against human labels **in this project**. No
  agreement rate is published here because none has been measured, and quoting
  one from a paper about a different dataset would be worse than saying nothing.

This is why human review exists (§5).

---

## 4. Regression detection

A run is compared against a baseline under a configurable policy
(`DEFAULT_REGRESSION_POLICY` in `lib/config.ts`):

| Metric | Direction | Tolerance | Blocking |
|---|---|---|---|
| correctness | higher | 3 points | yes |
| groundedness | higher | 3 points | yes |
| completeness | higher | 5 points | yes |
| overall | higher | 3 points | yes |
| passRate | higher | 3 points | yes |
| meanLatencyMs | lower | +25% relative | no |
| meanCostUsd | lower | +25% relative | no |
| *new failures* | — | 0 cases | yes |

Quality metrics use **absolute percentage points**; latency and cost use
**relative change**, because "+0.03s" and "+30%" mean very different things.

Three properties matter:

1. **Case-level transitions are first-class.** An aggregate can improve while
   three specific cases break. Those three are what the on-call engineer needs,
   and `maxNewFailures` gates on them independently of the averages.
2. **Only blocking metrics fail CI.** Correctness regressing 5 points stops a
   deploy. Latency regressing 26% is reported loudly and left to a human.
3. **The tool never says "better" on its own.** Quality up *and* cost up is
   reported as `mixed`, with both findings listed. That is a business tradeoff,
   and the evaluator does not get to make it.

The verdict and the gate are separate concepts:

- `verdict` — the *shape* of the change: `improved`, `regressed`, `mixed`, `neutral`
- `blocked` — the *decision*: did a blocking threshold breach, or did cases regress

`mixed` + `not blocked` is the normal outcome of a good change that costs
something. It ships.

Runs carry a **dataset content hash**. Comparing runs across different hashes
is still allowed, but flagged prominently, because the deltas then mix workflow
changes with dataset changes and mean nothing on their own.

---

## 5. Human review

Every case can carry a human verdict that overrides the automated one:

```
Automated score: 72%   (fail)
Human review:    ✓ Accept
Comment:         "Correct to decline — the customer still needs a follow-up though."
```

Two rules:

- **The automated score is never overwritten.** The override is stored beside
  it, so the disagreement stays auditable forever.
- **The run summary uses the effective verdict**, because pass rate is what
  gates a deploy.

The set of cases where humans overrule the judge is the data you need to answer
"is this judge good enough?". That is the real reason this feature exists — it
is not a convenience, it is the calibration set you will wish you had collected.

---

## 6. Reproducibility

- The default provider replays **recorded model responses** keyed by
  `<workflow>@<version>::<caseId>`. A missing recording is a hard error, never
  a silently empty answer — an empty answer would score as a legitimate failure
  and quietly corrupt a run.
- The default judge is deterministic.
- Case order is stable regardless of concurrency; results are written back by
  index.
- Latency from fixtures is replayed from the recording and marked
  `simulated: true`, so nobody mistakes it for a production measurement.

Consequence: `npm test` produces byte-identical scores on any machine, and CI
can assert exact numbers. The `tests/eval-smoke.test.ts` floors pin the figures
the README claims — if a scoring change silently moves them, that test fails and
somebody has to look.

---

## 7. What would make this materially better

In rough order of value per unit of effort:

1. **Calibrate the judge.** Human-label 100 cases, measure agreement for both
   judges, publish the confusion matrix. Every number above is a proxy until
   this exists.
2. **Confidence intervals.** 30 cases is a small sample. A 3-point difference
   on 30 cases is not obviously signal; the tool currently presents it as
   though it were. Bootstrap CIs on the aggregate would make that honest.
3. **Semantic retrieval.** Two of the three remaining v2 failures are retrieval
   misses, not prompting problems (see the README). Embeddings would fix them.
4. **Multi-turn cases.** Every case here is single-turn. Real support is a
   conversation, and the failure modes of turn 4 are not the failure modes of
   turn 1.
5. **Per-case variance.** Run each case N times against a live provider and
   report the spread, so run-to-run noise is visible rather than implied.
