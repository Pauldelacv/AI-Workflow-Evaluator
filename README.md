# AI Workflow Evaluator

**Lightweight evaluation and regression testing framework for production LLM workflows.**

Answers one question that teams shipping AI features usually cannot answer:

> *Did my latest change actually make this workflow better — and what did it cost?*

```
support-agent@v2-grounded  →  support-agent@v3-cost-optimised

metric         baseline  candidate  delta      verdict
-------------  --------  ---------  ---------  ----------
correctness    90.8%     78.6%      -12.2 pts  REGRESSION
groundedness   97.4%     97.4%      +0.0 pts   unchanged
completeness   93.0%     85.4%      -7.6 pts   REGRESSION
overall        93.0%     85.0%      -8.0 pts   REGRESSION
passRate       93.3%     76.7%      -16.6 pts  REGRESSION
meanLatencyMs  1.53s     0.62s      -59%       IMPROVED
meanCostUsd    $0.0013   $0.0004    -69%       IMPROVED

VERDICT: MIXED - improvements and regressions in the same run
  x 5 previously passing cases now fail: case-002, case-009, case-011, case-018, case-030
BLOCKED: a blocking threshold was breached.
```

That change made the workflow **69% cheaper and 59% faster**. It also broke five
things that used to work. A dashboard showing "85%" would have shipped it.

---

## The problem

Teams ship LLM features by looking at a handful of outputs and deciding they
seem fine. Then they change a prompt, and nobody can say whether that helped.

The specific failure is not "we have no metrics" — it is that the interesting
question is always **comparative**:

- Accuracy went from 89% to 94%. Did anything that used to work stop working?
- The new prompt is better on average. Is it better on *refund policy questions*,
  the ones that generate chargebacks?
- We halved cost by switching models. What exactly did we give up?

Averages hide all three. This tool is built around the comparison, not the score.

## Why AI workflow evaluation matters

Traditional software fails loudly. LLM workflows fail **plausibly** — the answer
is fluent, confident, well-formatted and wrong. Nobody notices until a customer
acts on a refund policy that does not exist.

Three properties follow, and they shape the whole design:

1. **You cannot test exhaustively**, so you need a representative dataset that
   covers the edges rather than the average.
2. **Improvements are not monotonic.** Fixing hallucination often costs latency;
   improving one category often breaks another. Only case-level comparison finds it.
3. **The failure mode is silent.** So the tooling has to be loud.

---

## Demo

Runs offline, deterministically, in about 30 seconds. No API key required.

```bash
git clone https://github.com/pauldelacv/ai-workflow-evaluator
cd ai-workflow-evaluator
npm install
npm run seed      # evaluate all three workflow versions
npm run dev       # http://localhost:3000
```

`npm run seed` prints the story:

```
run_50995a0e  v1-baseline          overall 49.3%  pass 33.3%  1.01s  $0.0007/case
run_c535738d  v2-grounded          overall 93.0%  pass 93.3%  1.53s  $0.0013/case
run_46115ff7  v3-cost-optimised    overall 85.0%  pass 76.7%  0.62s  $0.0004/case

v1-baseline -> v2-grounded: MIXED
v2-grounded -> v3-cost-optimised: MIXED (BLOCKED), 5 new failure(s)
```

| Dashboard | Run comparison |
|---|---|
| ![Dashboard](docs/images/dashboard.png) | ![Compare](docs/images/compare.png) |

| Failure analysis | Case detail |
|---|---|
| ![Run detail](docs/images/run-detail.png) | ![Case detail](docs/images/case-detail.png) |

---

## The FDE workflow this demonstrates

This is the loop a Forward Deployed Engineer actually runs with a client. Every
stage below is a real feature, not a slide.

```
  Discovery              Sit with the support team, collect the questions that
      │                  actually arrive — including the ones they get wrong
      ▼
  Representative cases   30 cases: straightforward, ambiguous, edge, policy,
      │                  out-of-scope, adversarial, hallucination-bait, precision
      ▼
  Baseline               v1 scores 49.3%. Now the argument is about evidence,
      │                  not taste.
      ▼
  Build                  ── the loop ──────────────────────────────┐
      ▼                                                            │
  Evaluate               30 cases, 5 metrics, per-case scores      │
      ▼                                                            │
  Diagnose               "Adversarial 0/3. Out-of-scope 0/3.       │
      │                   case-014 leaked a discount code."        │
      ▼                                                            │
  Iterate                Change the prompt / retrieval / model ────┘
      ▼
  Regression test        v3 is 69% cheaper — and breaks 5 cases. BLOCKED.
      ▼
  Deploy                 Docker image, health-checked, CI-gated
      ▼
  Monitor                Per-run latency, cost, tokens, scores, history
```

### What the demo actually found

**v1 — the version that ships first.** Policy retrieval is wired up, but the
prompt was written to keep customers happy rather than to keep answers true.

```
overall 49.3%   pass 33.3%   correctness 39.6%   groundedness 80.7%

adversarial         0/3    prompt injection succeeded; it emitted "DISCOUNT100"
out-of-scope        0/3    answered a weather question; read out a card number
edge-case           0/5    claimed to have issued refunds and extended trials
```

The diagnosis is not "the model is bad". It is **the prompt has no refusal
rules, no grounding requirement, and no statement of what the assistant cannot
do** — three specific, fixable things.

**v2 — the fix.** Retrieval widened to top-3, and the prompt rewritten to
require grounding in retrieved policy, quote exact figures, decline out-of-scope
and instruction-override requests, ask when ambiguous, and state plainly that it
cannot perform account actions.

```
overall 93.0%  (+43.7 pts)   pass 93.3%  (+60.0 pts)
correctness  39.6% → 90.8%   groundedness 80.7% → 97.4%
18 previously failing cases now pass, 0 regressions

TRADEOFF  latency 1.01s → 1.53s (+52%)
TRADEOFF  cost    $0.0007 → $0.0013 (+85%)
```

The tool reports this as **`mixed`, not `improved`** — the fix nearly doubled
cost per conversation. That is real and belongs in the decision. It is **not
blocked**, so it ships.

**The two cases v2 still fails are the honest part.** `case-025` and `case-026`
fail because the keyword retriever never surfaces the right policy snippet —
the answer correctly says "I don't have that information" and is scored wrong
for it. The next iteration is a **retrieval** fix, not another prompt rewrite.
A tool that let you conclude "prompt again" here would be worse than useless.

**v3 — the cost experiment.** A plausible next move: smaller model, one
retrieved snippet instead of three. 69% cheaper, 59% faster, and it silently
breaks five cases — including `case-011`, where "deleted within 30 days, backups
purged within 90 days" degraded to "removed from production systems, with
backups cleared shortly afterwards". Vague where a GDPR answer must be exact.

**BLOCKED.** That is the product.

---

## Architecture

All evaluation logic lives in `lib/`, which imports nothing from Next.js. The
CLI, CI, tests and web UI are thin adapters over the same functions — so the
number CI blocks on and the number a stakeholder reads cannot drift.

```
                    ┌──────────────────────────────────┐
                    │              lib/                │
                    │   (no framework dependencies)    │
   cli/awe.ts ─────▶│  datasets  providers  scoring    │◀───── app/api/*
   tests/ ─────────▶│  workflows judge      evaluator  │◀───── app/**/page.tsx
                    │  runs      regression            │
                    └──────────────────────────────────┘
                                    │
                                    ▼
                            .data/runs/*.json
```

```
dataset + workflow ─▶ retrieve ─▶ prompt ─▶ LLMProvider ─▶ Judge ─▶ scoreCase
                                                                        │
                                        detectRegression ◀── Run ◀──────┘
```

Full detail, including what was deliberately *not* built and why:
**[docs/architecture.md](docs/architecture.md)**.

**Stack:** TypeScript · Next.js 15 (App Router) · Tailwind 4 · Zod · Vitest ·
Docker · GitHub Actions. Storage is JSON files — a run is written once, read
whole, never queried by field.

---

## Quick start

```bash
npm install
npm run eval -- datasets                                    # what's available
npm run eval -- run acme-support v1-baseline --baseline none # baseline
npm run eval -- run acme-support v2-grounded                 # auto-compares
npm run eval -- run acme-support v3-cost-optimised --fail-on-regression  # exits 1
```

| Command | Purpose |
|---|---|
| `run <dataset> <version>` | Evaluate; compares against the last run by default |
| `compare <baseline> <candidate>` | Compare two stored runs |
| `show <runId>` | Full summary and every failure |
| `list` / `datasets` | Run history / available datasets |
| `validate <dataset>` | Validate a dataset and its workflows |

Useful flags: `--provider mock|anthropic`, `--judge heuristic|llm`,
`--baseline <runId|auto|none>`, `--fail-on-regression`, `--concurrency <n>`,
`--json`.

To evaluate a **live** model, set `ANTHROPIC_API_KEY` and add
`--provider anthropic`. Everything else is identical.

---

## Example dataset

`examples/acme-support/` — 30 cases for a fictional EU SaaS company, plus an
18-snippet policy base and three workflow versions.

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

| Category | n | What it probes |
|---|---|---|
| `straightforward` | 4 | Does the basic path work |
| `precision` | 5 | Exact figures, not paraphrase |
| `policy` | 4 | Multi-snippet policy reasoning |
| `edge-case` | 5 | Arithmetic, escalation, "can you just…" |
| `hallucination-bait` | 4 | Invites inventing a phone line, an SLA, a US region |
| `out-of-scope` | 3 | Must decline, not answer |
| `adversarial` | 3 | Prompt injection, social engineering |
| `ambiguous` | 2 | Must ask, not guess |

`mustNotInclude` entries are written **after** observing a failure. A model
invents a "60-day money-back guarantee" once; it becomes a permanent assertion.
That is regression testing applied to prompts.

---

## Metrics

| Metric | Question | Weight |
|---|---|---|
| **Correctness** | Does the answer give the right outcome? | 0.5 |
| **Groundedness** | Is every checkable claim traceable to retrieved context? | 0.25 |
| **Completeness** | Were the key points covered? | 0.25 |
| **Latency** | Per-call, mean and p95 | reported |
| **Cost** | Tokens × list price | reported |

A case passes at `overall ≥ 0.7` **and** no hard violation. Hard violations
bypass the average entirely: forbidden content, or answering a question that
should have been declined. Some failures must not be averaged away.

**Deterministic where possible, judged where necessary.** Literal assertions and
claim extraction are exact string work. Only semantic agreement goes to a judge —
a deterministic heuristic by default (so CI is reproducible), or
`--judge llm` for real semantic judgement.

**Honest about the limits.** Groundedness scores 1.0 for an answer containing no
numbers — vague answers *are* grounded, and are punished by the other two
metrics instead. The judge has never been calibrated against human labels, so no
accuracy claim is made for it. Full methodology and every known weakness:
**[docs/evaluation.md](docs/evaluation.md)**.

---

## Regression detection

Configurable per metric in `lib/config.ts`:

| Metric | Direction | Tolerance | Blocking |
|---|---|---|---|
| correctness / groundedness / overall / passRate | higher | 3 points | **yes** |
| completeness | higher | 5 points | **yes** |
| meanLatencyMs / meanCostUsd | lower | +25% relative | no |
| *new failures* | — | 0 cases | **yes** |

- **Case-level transitions are first-class.** An aggregate can improve while
  three specific cases break. Those three are what you need.
- **Only blocking metrics fail CI.** Correctness dropping 5 points stops a
  deploy. Latency rising 26% is reported loudly and left to a human.
- **The tool never says "better" on its own.** Quality up *and* cost up is
  `mixed`, with both findings listed.

Runs carry a **dataset content hash**; comparing across different hashes is
flagged, because those deltas mix workflow changes with dataset changes.

---

## Human review

Automated evaluation is a proxy, so any case can be overridden:

```
Automated score: 72%  (fail)
Human review:    ✓ Accept
Comment:         "Correct to decline — the customer still needs a follow-up."
```

The automated score is **never overwritten**; the verdict is stored beside it,
so the disagreement stays auditable. The run summary uses the effective verdict,
because pass rate is what gates a deploy.

The set of cases where humans overrule the judge is the calibration data you
will wish you had collected. That is the real reason this exists.

---

## Deployment

```bash
docker compose up --build     # http://localhost:3000
```

Multi-stage image, runs non-root (uid 1000), health-checked via `/api/health`,
run history on a mounted volume. Verified: builds, serves, evaluates in-container
with identical scores, and survives a restart with history intact.

Also documented: single VPS with systemd, and Vercel — including the caveat that
serverless filesystems are ephemeral, so run history needs the store swapped for
S3/Postgres. **[docs/deployment.md](docs/deployment.md)**.

---

## Testing

```bash
npm run verify    # typecheck + lint + test + build
```

**141 tests, all offline and deterministic.**

| Suite | Covers |
|---|---|
| `scoring` | The rubric, hard violations, weights, boundary clamping |
| `regression` | Thresholds, blocking vs tradeoff, case transitions, dataset mismatch |
| `evaluator` | End-to-end runs, ordering under concurrency, error isolation, retries |
| `judge` | Determinism, contradiction detection, JSON parsing, graceful degradation |
| `dataset` | Schema validation, duplicate ids, dangling references |
| `store` | Round-trip, atomic writes, path traversal, human review |
| `api` | Request validation, status codes, review round-trip |
| `text` / `cost` | Matching primitives, pricing arithmetic |
| `ui` | Formatters and the score colour scale |
| `eval-smoke` | **The full 30-case evaluation, pinning the numbers in this README** |

CI does something most eval projects skip: it **proves the gate works**. One
step asserts that re-running an identical workflow produces identical scores
(no non-determinism in scoring), and another asserts that the known v3
regression *is* blocked — if a real regression ever stops being caught, the
build fails.

---

## Limitations

Stated plainly, because the alternative is someone finding out later:

- **The metrics are proxies**, not ground truth.
- **The judge is uncalibrated.** No human-agreement rate has been measured, so
  none is claimed. This is the biggest gap.
- **30 cases is a small sample** and no confidence intervals are computed. Treat
  movements under ~5 points as unresolved.
- **Retrieval is keyword-based** — transparent, but it misses paraphrases. Two
  of v2's three residual failures are retrieval misses.
- **Recorded fixtures are hand-authored** to represent plausible per-version
  behaviour. They make the demo deterministic and offline; they are not evidence
  about a specific model's real behaviour. Use `--provider anthropic` for that.
- **Single-turn only.** Real support is a conversation.
- **Cost is list-price arithmetic** — no caching, batch or negotiated rates.
- **No authentication** — deliberate; put it behind your SSO proxy.

Full accounting, including the objections a reviewer would raise:
**[docs/limitations.md](docs/limitations.md)**.

---

## Future improvements

In order of value per unit of effort:

1. **Calibrate the judge** — human-label 100 cases, publish the agreement rate
   and confusion matrix for both judges. Everything else is a proxy until this
   exists.
2. **Confidence intervals** — bootstrap CIs so a 3-point delta is presented with
   the authority it has actually earned.
3. **Semantic retrieval** — fixes the two residual v2 failures, which are
   retrieval misses rather than prompting problems.
4. **Multi-turn cases** — the failure modes of turn 4 are not those of turn 1.
5. **Incremental evaluation** — cache by `(workflow hash, case id)` so iterating
   against a live provider only pays for what changed.
6. **Online monitoring** — sample production traffic into the same rubric, so
   the offline score and the live score are comparable.

---

## Project layout

```
app/          Next.js pages and API routes (thin adapters over lib/)
components/   UI primitives + two client components
lib/          All evaluation logic — no framework dependencies
  datasets/     parse, validate, hash
  workflows/    keyword retrieval
  providers/    LLMProvider: mock (recorded) + anthropic (live)
  judge/        Judge: heuristic (deterministic) + llm (opt-in)
  scoring/      the rubric
  evaluator/    orchestration, concurrency, aggregation
  regression/   baseline comparison and thresholds
  runs/         JSON store + human review
cli/          awe command line + demo seeder
examples/     datasets, workflow versions, recorded fixtures
tests/        141 tests
docs/         architecture, evaluation, deployment, limitations
```

## License

MIT
