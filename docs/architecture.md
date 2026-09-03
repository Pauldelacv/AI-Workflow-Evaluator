# Architecture

## The one decision that shapes everything else

**All evaluation logic lives in `lib/`, which imports nothing from Next.js.**

The CLI, the CI gate, the test suite and the web UI are four thin adapters over
the same functions. The number CI blocks on and the number a stakeholder reads
in the browser come from one implementation, so they cannot drift.

```
                    ┌──────────────────────────────────┐
                    │              lib/                │
                    │   (no framework dependencies)    │
                    │                                  │
   cli/awe.ts ─────▶│  datasets/   parse + hash        │◀───── app/api/*
   cli/seed.ts      │  workflows/  retrieval           │       (Next routes)
                    │  providers/  LLMProvider         │
   tests/ ─────────▶│  judge/      Judge               │◀───── app/**/page.tsx
                    │  scoring/    the rubric          │       (server components)
                    │  evaluator/  orchestration       │
                    │  regression/ baseline compare    │
                    │  runs/       JSON store          │
                    └──────────────────────────────────┘
                                    │
                                    ▼
                            .data/runs/*.json
```

## Request → score, end to end

```
 dataset.json ──┐
                ├──▶ retrieve(workflow, case, kb) ──▶ renderPrompt()
 workflow.json ─┘                                          │
                                                           ▼
                                             LLMProvider.complete()
                                          (mock: replay | anthropic: live)
                                                           │
                                                           ▼
                                                   Judge.judge()
                                        (heuristic: deterministic | llm: opt-in)
                                                           │
                                                           ▼
                                        scoreCase() ──▶ correctness
                                                        groundedness
                                                        completeness
                                                        overall, pass/fail
                                                           │
                                                           ▼
                                        summarise() ──▶ Run ──▶ RunStore
                                                                   │
                                                                   ▼
                                                    detectRegression(baseline, candidate)
```

## Directory map

| Path | Responsibility |
|---|---|
| `lib/types.ts` | Every persisted shape, as Zod schemas. The single source of truth. |
| `lib/datasets/` | Parse and validate datasets/workflows; content hashing |
| `lib/workflows/retrieval.ts` | Keyword retrieval over the knowledge base |
| `lib/providers/` | `LLMProvider` interface, mock and Anthropic implementations |
| `lib/judge/` | `Judge` interface, heuristic and LLM implementations |
| `lib/scoring/` | The rubric: correctness, groundedness, completeness |
| `lib/evaluator/` | Orchestration, concurrency, retries, aggregation |
| `lib/regression/` | Baseline comparison, thresholds, verdicts |
| `lib/runs/store.ts` | Persistence and human review |
| `lib/api.ts` | Request handling shared by the API routes |
| `cli/` | `awe` command line and the demo seeder |
| `app/` | Next.js App Router pages and API routes (thin adapters) |
| `components/` | UI primitives and the two client components |
| `examples/<id>/` | Datasets, workflow versions and recorded fixtures |
| `tests/` | 141 tests, all offline |

## Validation boundaries

Datasets and workflows are hand-edited JSON, often by a domain expert rather
than an engineer. They are **parsed, never cast**, at every entry point, and
validation errors name the field path:

```
Invalid dataset:
  - cases.7.keyPoints: Array must contain at least 1 element(s)
  - cases.12.groundingRefs: Case "case-013" references unknown knowledge snippet "kb-typo"
```

Stored runs are re-validated on read. A run written by an older schema fails
loudly rather than silently deserialising into a half-populated object.

The schemas are `.strict()`, so a typo in a field name is an error rather than
a silently ignored key.

## The provider abstraction

```ts
export interface LLMProvider {
  readonly id: string;
  readonly supportsRealCalls: boolean;
  complete(request: LLMRequest): Promise<LLMResult>;
}
```

Adding a provider means implementing this interface. No evaluator, scoring or
UI code changes.

**What is deliberately absent: `temperature`, `top_p`, `top_k`.** Current
Claude models reject sampling parameters with a 400, and a cross-provider
abstraction that leaks provider-specific knobs stops being an abstraction.
Run-to-run variation is handled by running the eval more than once, not by
pinning a temperature.

### `MockProvider` — why it is the default

It replays responses recorded per `<workflow>@<version>::<caseId>`.

- CI runs the full 30-case evaluation with **no API key and no network**.
- Scoring changes can be reviewed against a frozen set of model outputs, so a
  metric delta means *the metric changed*, not *the model drifted*.
- A contributor can run the entire demo in five minutes.

Input tokens are derived from the prompt that was actually rendered, so a
longer system prompt or more retrieved context genuinely costs more — the cost
comparison between versions is real even on recorded data. Output tokens come
from the recorded text. Latency is replayed from the recording and flagged
`simulated: true`.

A missing recording throws. It never returns an empty answer, which would score
as a legitimate failure and quietly corrupt the run.

### `AnthropicProvider` — optional

Wraps the official SDK. Errors are mapped onto a retryable / non-retryable
split (`APIConnectionError` is checked before `APIError` — it is a subclass in
the TypeScript SDK). Retryable failures get three attempts with exponential
backoff; non-retryable ones fail that case only.

## Error handling policy

| Failure | Behaviour |
|---|---|
| One case's provider call fails | Case scored 0, marked `error`, run continues. `summary.erroredCases` reports it. |
| Retryable provider error | 3 attempts, exponential backoff (250ms, 500ms) |
| LLM judge unavailable or unparseable | Degrade to the heuristic judge, flag `degraded`, record it in the failure reasons |
| Missing fixture | Hard error — never a silent empty answer |
| Invalid dataset | Hard error, with every field path listed |
| Stored run fails schema validation | Hard error on read |

One failed case must never lose the other 29.

## Concurrency

A bounded worker pool (default 4) pulls from a shared cursor. Results are
written back **by index**, so run order always matches dataset order regardless
of completion order. Verified by a test that runs the same dataset at
concurrency 1 and 8 and asserts identical output.

## Storage: why JSON files, not SQLite

A run is written once, read whole, and never queried by field. At the scale this
tool targets — hundreds of runs, tens of cases each — a directory of JSON
documents is faster to reason about, trivially diffable, greppable, and copies
between machines with `scp`.

Writes are atomic (write to a temp file, then rename) because a half-written run
file would poison every later read. Run ids are validated against
`/^[A-Za-z0-9_-]+$/` before touching the filesystem, since the store is
reachable from an HTTP route.

If cross-run querying is ever needed, `lib/runs/store.ts` is the only file that
changes. That is the whole point of it being a module.

## What was deliberately not built

| Not built | Why |
|---|---|
| Vector database | Keyword retrieval makes groundedness failures explainable ("the snippet was never retrieved"). A vector store would add a service and hide the mechanism. |
| Job queue / worker | A 30-case run takes under a second on fixtures and under a minute live. A queue would add infrastructure to solve a problem this tool does not have. |
| Separate backend service | The evaluator is a library. Next.js already provides HTTP. |
| Authentication | This is a single-team internal tool. Auth is a deployment concern — put it behind your existing SSO proxy. |
| Streaming run progress | The CLI prints per-case progress; the UI shows a pending state. Server-sent events would be real work for a sub-second operation. |
| Postgres / Redis | See storage above. |

The constraint driving all of these: a recruiter should understand the whole
project in ten minutes, and an engineer should run it in five.
