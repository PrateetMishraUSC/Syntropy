# Phase 2 — Connect GitHub Account + Private Repos

> The user connects their GitHub account once, then browses and imports from **their own** repos — public and private — instead of pasting URLs.

Phase 2 is intentionally small. The hard part (analysis → canvas) is done. Phase 2 only changes **where the repo data comes from** and adds a **repo-picker UI**.

---

## What's reused vs. new

```
REUSED UNCHANGED (from Phase 1)              NEW (Phase 2)
─────────────────────────────               ─────────────
lib/github.ts            (GitHubClient)      lib/github-oauth.ts   (get user token)
lib/repo-analysis.ts     (analyzeRepo)       app/api/github/repos/route.ts   (list repos)
trigger/github-analyzer.ts                   app/api/github/status/route.ts  (is connected?)
trigger/lib/*            (canvas shared)      app/api/github/disconnect/route.ts (custom path)
app/api/github/import/*  (trigger + token)   components/editor/github-repo-browser.tsx
RepoImport model                             GitHubConnection model (custom-OAuth path ONLY)
```

The `github-analyzer` task already accepts `accessToken?: string`. Phase 1 leaves it undefined (→ uses the server `GITHUB_TOKEN`). Phase 2 passes the **user's** token, which unlocks their private repos. The task body does not change at all.

---

## User flow

```
1. User opens the Import modal (Phase 1 UI gains a second tab/section).
2. If not connected: "Connect GitHub" button → OAuth → back to Syntropy.
3. Once connected: a searchable list of their repos (name, visibility badge,
   language, last-updated) loads.
4. User clicks a repo → same import pipeline runs → diagram on canvas.
5. The URL-paste field from Phase 1 stays available as a secondary option
   (great for importing repos they don't own).
```

---

## The one real decision: which OAuth path?

You have two ways to get a user's GitHub token. **Pick one** — File 36 specs both, but recommends the first.

### Path A — Clerk-managed OAuth (recommended)

Clerk is already your auth provider. Add GitHub as a **social connection** in Clerk, request the `repo`/`read:user` scopes, and retrieve the token server-side with Clerk's API. 

- **Pros:** no token table, no encryption, no callback route, no refresh logic — Clerk stores and refreshes the token. Least code, least security surface.
- **Cons:** you rely on Clerk's OAuth scopes config; the same GitHub connection may be used for login, which you must reason about (see 2.2).
- **New data model:** none.

### Path B — Custom GitHub OAuth App

Register your own GitHub OAuth App, run the authorize/callback dance yourself, encrypt and store the token in a `GitHubConnection` table.

- **Pros:** full control, independent of Clerk, explicit scopes per feature.
- **Cons:** you own token storage, encryption at rest, the callback route, disconnect, and (if you request it) refresh.
- **New data model:** `GitHubConnection`.

> **Recommendation:** Path A. You already trust Clerk with identity; letting it hold the GitHub token too removes the riskiest part of this feature (storing third-party access tokens). Only choose Path B if you need GitHub scopes Clerk can't grant, or you want the GitHub connection fully decoupled from login.

---

## Scopes

Whichever path, request the **minimum**:

| Scope | Why | Needed? |
|-------|-----|---------|
| `read:user` | Read the user's GitHub login/profile to label the connection | Yes |
| `repo` | Read **private** repos (contents + metadata) | Yes, for the core value prop |
| `public_repo` | Public repos only | Use this instead of `repo` if you decide to defer private-repo support |

`repo` is a broad scope (read **and write** to all repos). Syntropy only reads. Be transparent in the connect UI: "Syntropy only reads repository structure to generate diagrams. It never writes to your code." If you want least-privilege and can accept public-only for now, use `public_repo` and ship private support later behind a clearer consent screen.

---

## Crucial functionality not to skip

1. **Connection status check.** Before showing the repo browser, the client must know whether the user is connected (`/api/github/status`). Drives the connect-vs-browse fork. (see 37)
2. **Pagination + search.** A user can have hundreds of repos. The repos API must paginate (GitHub returns 30/page) and support a query. (see 37)
3. **Token-scoped imports.** `/api/github/import` must, in Phase 2, fetch the caller's token server-side and pass it to the task. Never send the token to the client. (2.2 + 2.3)
4. **Private-repo authorization integrity.** The token belongs to the user who connected it. Only that user's import requests may use it. The existing project-access check still gates which canvas they can write to. (see 36)
5. **Graceful "token revoked" handling.** Users can revoke access on GitHub at any time. A 401 from GitHub mid-import must surface as "Your GitHub connection expired — reconnect." (see 37)
6. **Disconnect.** Users must be able to disconnect (Path B: delete the row; Path A: Clerk handles, but offer a link/affordance). (see 37)

---

## Phase 2 file checklist

- [ ] Decide Path A or B.
- [ ] `lib/github-oauth.ts` — `getUserGitHubToken(userId)` abstraction (hides A vs B).
- [ ] `app/api/github/status/route.ts`
- [ ] `app/api/github/repos/route.ts`
- [ ] `app/api/github/disconnect/route.ts` (Path B)
- [ ] `prisma/models/github-connection.prisma` (Path B)
- [ ] `/api/github/import/route.ts` — **modify** to attach the user token.
- [ ] `components/editor/github-repo-browser.tsx`
- [ ] `github-import-modal.tsx` — **modify** to add the "From my repos" section/tab.

Proceed to `36-github-oauth-tokens.md`.
