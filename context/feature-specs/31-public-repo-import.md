# Phase 1 — Public Repo Import (by URL)

Paste any public GitHub URL → get a system-design diagram on the canvas. No auth, no OAuth.

This is the viral, zero-friction entry point. It validates the **entire** analysis → canvas pipeline that Phase 2 later builds on.

## User flow

```
1. User is in the editor workspace (already has a roomId + projectId).
2. Clicks "Import" in the navbar (next to Templates / Share).
3. Modal opens: a single input — "Paste a public GitHub repo URL".
4. User pastes  https://github.com/tiangolo/fastapi  → clicks Import.
5. Modal shows inline progress (driven by the same realtime status as AI Architect):
      "Fetching repository…"
      "Analyzing 1,240 files…"
      "Designing architecture…"
      "Placing 9 nodes and 11 connections…"
6. Nodes + edges stream onto the canvas live. Modal auto-closes on "done".
7. The diagram is now an ordinary canvas — user edits it, runs AI Architect on it,
   generates a spec from it. All existing features work unchanged.
```

Because the importer writes to the **same Liveblocks storage** as everything else, every collaborator in the room watches the diagram appear in real time, and autosave persists it with zero extra work.

## Architecture

```
┌──────────────┐   POST /api/github/import      ┌───────────────────────────┐
│  Import Modal │ ─────────────────────────────► │  /api/github/import        │
│ (client)      │   { url, roomId, projectId }    │  - auth (Clerk)            │
│               │                                 │  - access check (project)  │
│               │ ◄───────────────────────────── │  - parse + validate URL    │
│               │   { runId, publicToken }        │  - tasks.trigger(...)      │
└──────┬───────┘                                 │  - record RepoImport       │
       │                                          └────────────┬──────────────┘
       │ useRealtimeRun(runId, { accessToken })                │ trigger
       │                                                       ▼
       │                                          ┌───────────────────────────┐
       │  metadata.status / message               │ trigger/github-analyzer.ts │
       │ ◄─────────────────────────────────────── │                            │
       │                                          │ 1. GitHubClient.getRepo    │
       │                                          │ 2. getTree (1 request)     │
       │                                          │ 3. fetch ~15 signal files  │
       │                                          │ 4. analyzeRepo()           │
       │                                          │ 5. generateText(Gemini,    │
       │                                          │      sharedCanvasTools)    │
       │                                          │ 6. applyCanvasMutations()  │──┐
       │                                          │ 7. broadcast "done"        │  │
       │                                          └───────────────────────────┘  │
       │                                                                          │ mutateStorage
       ▼                                                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Liveblocks room storage  →  canvas-flow.tsx renders nodes/edges for ALL clients   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Compare this to `/api/ai/design` → `design-agent.ts`: it is the **same shape**. The only differences are steps 1–4 (GitHub fetch + analysis) replacing "read the chat prompt", and the LLM input being a repo analysis instead of a sentence.

## What gets built in Phase 1

| File | Spec | Role |
|------|------|------|
| `lib/github.ts` | 32 | Fetch-based GitHub REST client. Parse URLs, get repo meta, get file tree, read files. |
| `lib/repo-analysis.ts` | 32 | Turn raw GitHub data into a structured `RepoAnalysis` (languages, services, infra, key file excerpts). |
| `trigger/lib/canvas-tools.ts` | 33 | **Extracted** from design-agent: tool defs, color palette, shared canvas conventions. |
| `trigger/lib/apply-canvas-mutations.ts` | 33 | **Extracted**: the `mutateStorage` tool-call → Liveblocks loop. |
| `trigger/lib/task-status.ts` | 33 | **Extracted**: status/presence/broadcast helpers. |
| `trigger/github-analyzer.ts` | 33 | New durable task: analyze → LLM → apply. |
| `app/api/github/import/route.ts` | 33 | Trigger endpoint (mirrors `/api/ai/design`). |
| `app/api/github/import/token/route.ts` | 33 | Realtime-token refresh (mirrors `/api/ai/design/token`). |
| `prisma/models/repo-import.prisma` | 33 | Import-history model. |
| `components/editor/github-import-modal.tsx` | 34 | The URL-paste UI + progress + errors. |
| `components/editor/workspace-client.tsx` | 34 | **Modified**: add the navbar button + modal state. |
| `trigger/design-agent.ts` | 33 | **Modified**: import the extracted `trigger/lib/*`. |

## Crucial functionality not to skip

These are the things that make the difference between a demo and a shippable feature:

1. **Server token for rate limits.** Unauthenticated GitHub API = 60 req/hr, shared across *all* your users by IP — it will exhaust instantly in production. A single server `GITHUB_TOKEN` lifts this to 5,000 req/hr. Non-negotiable for deploy. (see 32)

2. **One-request file tree.** Use `GET /repos/:owner/:repo/git/trees/:branch?recursive=1` to pull the entire file list in a single call, instead of walking directories. (see 32)

3. **Bounded file reads.** Never read more than ~15–20 files. Big repos have 10k+ files; reading them all blows the rate limit, the LLM context window, and the task timeout. Read only high-signal config files. (see 32)

4. **Truncation of large files.** A `package.json` in a monorepo or a giant `docker-compose.yml` must be excerpt-capped (e.g., 4 KB) before going into the prompt. (see 32)

5. **Empty / tiny repo handling.** A repo with no recognizable signals should still produce *something* (a minimal skeleton from the README + languages) rather than an error. (see 32 + 33)

6. **Append vs. replace semantics.** Decide and implement: does import **clear** the canvas first, or **add to** it? Recommended: if the canvas already has nodes, ask the user (modal toggle: "Replace canvas" / "Add to canvas"). The task reads existing state exactly like `design-agent` already does. (see 33 + 34)

7. **Durable execution.** Large-repo analysis + LLM generation can exceed serverless limits — this is *why* it must run in Trigger.dev, not in the API route. (see 33)

8. **Private-repo-without-token error.** In Phase 1, a private repo returns 404 from GitHub (the server token can't see it). Detect this and show "This repo is private — connect your GitHub account in Phase 2" rather than a generic failure. (see 32 + 34)

---

## Out of scope for Phase 1 (deferred to Phase 2)

- Listing a user's repos (needs their token).
- Private repositories.
- Any OAuth.
- Caching analysis across imports (nice-to-have; `RepoImport` lays the groundwork but Phase 1 doesn't read it back).
