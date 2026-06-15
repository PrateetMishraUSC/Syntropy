Turn any GitHub repository into a live architecture diagram on the Syntropy canvas.
This folder contains the full feature specification, split across two phases.

## The feature in one sentence

A user provides a GitHub repository (Phase 1: paste any public URL; Phase 2: connect their account and pick from their own public/private repos), Syntropy analyzes the codebase's structure, and an AI agent draws the inferred system architecture onto the live canvas in real time — reusing the exact same canvas-mutation pipeline that already powers the AI Architect.

**Build Phase 1 completely before starting Phase 2.** Phase 1 validates the entire analysis → canvas pipeline. Phase 2 only swaps the *source* of the repo data (a user token instead of a server token) and adds a repo-picker UI on top — ~80% of the code is shared.

## How this plugs into the existing codebase

The feature is deliberately built on patterns that **already exist** in Syntropy. Nothing here is novel infrastructure — it is the AI Architect pipeline pointed at a new input.

```
                         EXISTING (AI Architect)          NEW (GitHub Import)
                         ─────────────────────            ───────────────────
  Input source           chat prompt (text)               GitHub repo analysis
  Trigger task           trigger/design-agent.ts          trigger/github-analyzer.ts
  LLM                    google("gemini-2.5-flash")       google("gemini-2.5-flash")   ← same
  Canvas tools           canvasTools (inline)             SHARED via trigger/lib/       ← extracted
  Canvas write           mutateStorage (inline)           SHARED via trigger/lib/       ← extracted
  Status/broadcast       metadata.set + broadcastEvent    SHARED via trigger/lib/       ← extracted
  API trigger pattern    /api/ai/design/route.ts          /api/github/import/route.ts  ← same shape
  Realtime token         triggerAuth.createPublicToken    triggerAuth.createPublicToken ← same
  Frontend subscribe     useRealtimeRun + RunSubscriber   useRealtimeRun (reused)      ← same
```

### The single most important refactor

Today, `trigger/design-agent.ts` contains three things inline that the new task must reuse **verbatim**:

1. The `canvasTools` object (addNode, addEdge, etc.) and the `NODE_COLORS` / shapes / arrow constants.
2. The `mutateStorage` loop that translates tool calls into Liveblocks `LiveObject`/`LiveMap` writes.
3. The status helpers (`setStatus`, presence, `broadcastEvent`).

File 33 extracts these into `trigger/lib/` **without changing their behavior**, then rewrites `design-agent.ts` to import them. The new `github-analyzer.ts` imports the same modules. This guarantees a node drawn by GitHub import is byte-identical to a node drawn by the AI Architect — same shape set, same colors, same `LiveObject` shape that `canvas-flow.tsx` already renders.

## Environment variables

| Var | Phase | Purpose | Notes |
|-----|-------|---------|-------|
| `GITHUB_TOKEN` | 1 | Server-side PAT for public-repo reads | Lifts rate limit 60 → 5,000 req/hr. Classic PAT, **no scopes needed** for public repos. Store in Trigger.dev env + Vercel env. |
| `GITHUB_OAUTH_CLIENT_ID` | 2 | OAuth app client id | Only if using the custom OAuth path (not Clerk) |
| `GITHUB_OAUTH_CLIENT_SECRET` | 2 | OAuth app secret | Only if using the custom OAuth path |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | 2 | 32-byte key for encrypting stored tokens at rest | Only if storing tokens yourself (custom path) |

All existing vars (`LIVEBLOCKS_SECRET_KEY`, `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, Trigger.dev keys, Clerk keys, `BLOB_READ_WRITE_TOKEN`) are unchanged.

## Data-model summary (both phases)

New Prisma models, following the existing split-file convention in `prisma/models/`:

```
prisma/models/repo-import.prisma     (Phase 1)  — history of repo→canvas imports
prisma/models/github-connection.prisma (Phase 2, custom-OAuth path only) — stored user tokens
```

`RepoImport` is written by the `github-analyzer` task and powers import history + "last imported from X" UI. `GitHubConnection` is only needed if you do **not** use Clerk's managed OAuth (see 36 — the Clerk path needs no token table at all).

Full model definitions are in 33 and 36.

## Complete new-file manifest

```
lib/
  github.ts                          # 32  GitHub REST client (fetch-based, no SDK)
  repo-analysis.ts                   # 32  Repo → structured RepoAnalysis
  github-oauth.ts                    # 36  Token retrieval (Clerk or DB)
trigger/
  github-analyzer.ts                 # 33  New durable task
  lib/
    canvas-tools.ts                  # 33  Extracted: tools + palette + conventions
    apply-canvas-mutations.ts        # 33  Extracted: tool-calls → Liveblocks
    task-status.ts                   # 33  Extracted: status/presence/broadcast helpers
app/api/github/
  import/route.ts                    # 33  Trigger an import
  import/token/route.ts              # 33  Refresh realtime token
  repos/route.ts                     # 37  List the connected user's repos
  status/route.ts                    # 37  Is GitHub connected?
  disconnect/route.ts                # 37  Remove connection (custom path)
components/editor/
  github-import-modal.tsx            # 34  URL-paste modal (Phase 1)
  github-repo-browser.tsx            # 37  Repo picker (Phase 2)
prisma/models/
  repo-import.prisma                 # 33
  github-connection.prisma           # 36 (custom path only)
```

Modified existing files:
```
trigger/design-agent.ts              # 33  Refactored to import trigger/lib/*
components/editor/workspace-client.tsx  # 34  Wire in the Import button + modal
```

---

## Guiding principles for this build

1. **Reuse, don't reinvent.** Every canvas write goes through the shared `trigger/lib/` modules. If you find yourself re-implementing `mutateStorage`, stop.
2. **Analysis is structural, not exhaustive.** Never read every file. Read the file *tree* (one request) + ~15 high-signal config files. The LLM infers architecture from signals, not source code. See 32.
3. **Fail soft, surface clearly.** Private repo without a token, bad URL, rate limit, empty repo — each has a defined user-facing error in 34.
4. **One pipeline, two sources.** The `github-analyzer` task accepts an optional `accessToken`. Phase 1 passes the server `GITHUB_TOKEN`; Phase 2 passes the user's token. The task body is identical.
