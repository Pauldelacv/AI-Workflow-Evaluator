# Deployment

The app is a standard Next.js application with one unusual requirement: it
writes run history to disk. Everything below is about that.

## What it needs

| Requirement | Detail |
|---|---|
| Node | 20.9+ (CI and the image use 22) |
| Writable directory | `AWE_DATA_DIR`, default `./.data` — run history |
| Readable directory | `AWE_EXAMPLES_DIR`, default `./examples` — datasets, workflows, fixtures |
| Credentials | **None**, unless you use `--provider anthropic` or `--judge llm` |
| Memory | ~256MB idle; a 30-case run is not memory-bound |

There is no database, no cache, no queue and no external service.

## Option 1 — Docker (recommended)

```bash
docker compose up --build
# http://localhost:3000
```

Or plain Docker:

```bash
docker build -t ai-workflow-evaluator .
docker run -p 3000:3000 -v awe-data:/data ai-workflow-evaluator
```

The image is multi-stage: `deps` installs, `builder` compiles, `runner` carries
only Next's standalone server bundle, the static assets and `examples/`. No dev
dependencies, no source, no build cache.

Properties worth knowing:

- Runs as the unprivileged `node` user (uid 1000).
- `AWE_DATA_DIR=/data`, declared as a volume — **mount it or you lose run
  history on every container replacement.**
- `HEALTHCHECK` polls `/api/health`, which confirms datasets are readable
  rather than merely that Node is up.
- `examples/` ships inside the image. To evaluate your own dataset, mount it:
  `-v $(pwd)/my-datasets:/app/examples`.

To use a live model, pass the key at run time — never bake it into the image:

```bash
docker run -p 3000:3000 -v awe-data:/data -e ANTHROPIC_API_KEY=sk-ant-... ai-workflow-evaluator
```

## Option 2 — Single VPS

```bash
git clone <repo> && cd ai-workflow-evaluator
npm ci
npm run build
npm run seed          # optional: populate the demo runs
NODE_ENV=production npm run start
```

Put nginx or Caddy in front for TLS, and run it under systemd:

```ini
[Unit]
Description=AI Workflow Evaluator
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ai-workflow-evaluator
Environment=NODE_ENV=production
Environment=AWE_DATA_DIR=/var/lib/awe
ExecStart=/usr/bin/npm run start
Restart=on-failure
User=awe

[Install]
WantedBy=multi-user.target
```

Back up `AWE_DATA_DIR`. It is the only state, and it is just JSON files.

## Option 3 — Vercel (with one caveat)

`npm run build` deploys to Vercel as-is and the UI works, **but serverless
filesystems are ephemeral**: runs written by one invocation are not guaranteed
to be visible to the next, and nothing survives a redeploy.

That makes Vercel fine for a read-only demo of committed results, and wrong for
a team that actually iterates. Two honest options:

- Deploy the container (Option 1 or 2) where a volume can be mounted, or
- Replace `lib/runs/store.ts` with an S3/Postgres-backed implementation. It is
  a single module behind a small interface, and the rest of the codebase does
  not care.

Recommending Vercel without this caveat would be the kind of advice that
produces a support ticket three weeks later.

## CI

`.github/workflows/ci.yml` runs two jobs on every push:

**`verify`** — install, typecheck, lint, test, production build.

**`evaluation-gate`** — the interesting one. With no API key and no network:

1. Validate the dataset.
2. Establish a baseline (`v2-grounded`).
3. Re-run the same version with `--fail-on-regression`. Identical inputs must
   produce identical scores; if this fails, something non-deterministic entered
   the scoring path, which is the one thing an evaluator may never have.
4. Run `v3-cost-optimised` and assert that the gate **does** block it. If a
   known regression stops being caught, regression detection is broken and the
   build fails.

Run artefacts are uploaded so a failing run can be inspected after the fact.

To gate on a live-model evaluation instead, add `ANTHROPIC_API_KEY` as a repo
secret and run `npm run eval -- run <dataset> <version> --provider anthropic
--fail-on-regression`. Expect run-to-run noise, and widen the thresholds in
`lib/config.ts` accordingly — a live gate that flaps gets disabled within a week.

## Operating notes

**Backups.** `AWE_DATA_DIR` only. `tar czf runs-$(date +%F).tar.gz .data/runs`.

**Retention.** Runs are small (~50KB each). Thousands are fine. `RunStore.list()`
reads every file, so if you reach five figures, prune or add an index — the
module is the only thing that changes.

**Secrets.** `ANTHROPIC_API_KEY` is read from the environment and never written
into a run document. Runs record the *provider id*, not credentials, so run
JSON is safe to share.

**Scaling.** The bottleneck is provider rate limits, not this app. Tune
`--concurrency` (default 4). Against a live provider, start low.

**Upgrades.** Stored runs are schema-validated on read. A breaking schema change
makes old runs fail loudly rather than deserialise into something wrong — if you
change `lib/types.ts`, either migrate `.data/runs/*.json` or accept losing
history.
