# Limitations

What is genuinely production-ready here, and what is a demo. Being wrong about
this distinction is how evaluation tooling loses a team's trust.

## Production-ready

- **The evaluation loop.** Dataset → run → score → diagnose → compare →
  regression gate works end to end, is deterministic, and is covered by 141
  tests.
- **Regression detection.** Configurable thresholds, blocking vs non-blocking
  metrics, case-level transitions, dataset-hash mismatch detection. This is the
  most solid part of the project and the part most worth reusing.
- **The provider abstraction.** Narrow interface, two implementations, no leaked
  provider specifics.
- **The CI gate.** Runs offline, deterministically, and is itself tested — CI
  asserts that a known regression is actually blocked.
- **Deployment.** Multi-stage image, non-root, health-checked, volume-backed,
  verified running.
- **Failure diagnosis.** Every score carries its evidence. Every failing case
  shows input, expected, actual, retrieved context and the specific reason.

## Demo-grade

- **The metrics are proxies.** Correctness, groundedness and completeness are
  defensible heuristics, not ground truth. See `docs/evaluation.md` §2 for what
  each one measures and what it misses.
- **The judge is uncalibrated.** No agreement rate against human labels has been
  measured, so no accuracy claim is made for it. This is the single biggest gap.
- **30 cases is a small sample.** No confidence intervals are computed, so a
  3-point delta is presented with more authority than it has earned. Treat
  sub-5-point movements as unresolved.
- **Retrieval is keyword-based.** Transparent and explainable, but it misses
  paraphrases — two of the three residual v2 failures are retrieval misses, not
  prompting problems.
- **Recorded fixtures are hand-authored**, representing plausible model
  behaviour for each version rather than captured production traffic. They make
  the demo deterministic and offline; they are not evidence about any specific
  model's real behaviour. Point the tool at `--provider anthropic` for that.
- **Single-turn only.** Real support is a conversation.
- **Cost is list-price arithmetic.** No caching, batch or negotiated rates.
- **No authentication.** Deliberate: put it behind your existing SSO proxy.
- **Concurrent writes to one run are last-write-wins.** Fine for one team;
  wrong for many simultaneous reviewers.

## Things a reviewer might reasonably object to

**"Groundedness scores 1.0 for an answer with no numbers."** Correct, and
documented. Vague answers are grounded. It is why the three metrics are read as
a set, never individually. A better implementation would extract entity claims
too, not just numeric ones.

**"The heuristic judge is just token overlap."** Largely true. It is the default
because it is reproducible, which is what CI needs. `--judge llm` is one flag
away when semantic judgement matters more than determinism.

**"The v1 baseline is a strawman."** v1 has working retrieval and a plausible
prompt — the weakness is that it was written to keep customers happy rather than
to keep answers true, which is exactly what a first version usually looks like.
It scores 49%, not 5%. Its failures are concentrated in adversarial, out-of-scope
and edge cases, which is where real first versions fail.

**"You wrote both the dataset and the fixtures, so of course v2 wins."** Fair,
and worth stating plainly: the *demo* is authored. The *machinery* is not — point
it at a live provider and the same rubric applies to output nobody authored. The
scoring code has no knowledge of which version produced an answer.

## Where this breaks first at scale

1. `RunStore.list()` reads every run file. Five figures of runs need an index.
2. Runs are loaded whole into memory. A 10,000-case dataset needs streaming.
3. No incremental evaluation — every run evaluates every case. Caching by
   `(workflow hash, case id)` would make iteration much cheaper against a live
   provider.
4. Retrieval is O(cases × snippets) per run. Fine to thousands of snippets.
