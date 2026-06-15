# Repos API + Repo-Browser UI (Phase 2)

Final piece: list the connected user's repos and let them pick one. The picked repo's `html_url` flows into the **same** `/api/github/import` endpoint from Phase 1 — no new import path.

---

## Backend

### `app/api/github/status/route.ts`

Tells the client whether to show "Connect" or the repo browser.

```ts
import { auth } from "@clerk/nextjs/server";
import { getUserGitHubIdentity } from "@/lib/github-oauth";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const identity = await getUserGitHubIdentity(userId);
  if (!identity) return Response.json({ connected: false });

  // Confirm the token still works + get the login for display.
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${identity.token}`, Accept: "application/vnd.github+json", "User-Agent": "Syntropy" },
  });
  if (res.status === 401) return Response.json({ connected: false, revoked: true });
  const login = identity.login ?? ((await res.json().catch(() => null)) as { login?: string } | null)?.login ?? null;
  return Response.json({ connected: true, login });
}
```

### `app/api/github/repos/route.ts`

Paginated, searchable repo list. Returns only metadata — never the token.

```ts
import { auth } from "@clerk/nextjs/server";
import { getUserGitHubToken } from "@/lib/github-oauth";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const token = await getUserGitHubToken(userId);
  if (!token) return Response.json({ error: "Not connected" }, { status: 403 });

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  // Sorted by recently pushed; affiliation includes repos the user can read.
  const res = await fetch(
    `https://api.github.com/user/repos?per_page=30&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Syntropy" } },
  );

  if (res.status === 401) return Response.json({ error: "GitHub connection expired", revoked: true }, { status: 401 });
  if (!res.ok) return Response.json({ error: "Failed to load repositories" }, { status: 502 });

  type GhRepo = {
    id: number; name: string; full_name: string; html_url: string;
    description: string | null; language: string | null;
    private: boolean; fork: boolean; stargazers_count: number; pushed_at: string;
  };
  const repos = (await res.json()) as GhRepo[];

  const mapped = repos
    .filter((r) => (q ? r.full_name.toLowerCase().includes(q) : true))
    .map((r) => ({
      id: r.id, name: r.name, fullName: r.full_name, url: r.html_url,
      description: r.description, language: r.language,
      isPrivate: r.private, isFork: r.fork, stars: r.stargazers_count, pushedAt: r.pushed_at,
    }));

  // GitHub sends a Link header for next-page detection.
  const hasNext = (res.headers.get("link") ?? "").includes('rel="next"');
  return Response.json({ repos: mapped, page, hasNext });
}
```

> **Server-side search caveat:** GitHub's `/user/repos` doesn't accept a text query, so the `q` filter above is applied per-page. For a thorough search across all repos, either (a) fetch a few pages and filter, or (b) use the Search API `GET /search/repositories?q=user:<login>+<term>`. For a repo-picker, per-page filtering plus pagination is usually enough; document this so it isn't mistaken for a bug.

### `app/api/github/disconnect/route.ts` (Path B only)

```ts
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.gitHubConnection.deleteMany({ where: { userId } });
  return Response.json({ ok: true });
}
```

(Path A: disconnect happens in Clerk's account UI; offer a link instead.)

---

## Frontend — `components/editor/github-repo-browser.tsx`

Rendered inside the import modal as a second mode. Connected → searchable repo list; not connected → connect CTA.

```tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { Github, Lock, GitFork, Star, Loader2, Search, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Repo {
  id: number; name: string; fullName: string; url: string
  description: string | null; language: string | null
  isPrivate: boolean; isFork: boolean; stars: number; pushedAt: string
}

interface GitHubRepoBrowserProps {
  onPick: (repoUrl: string) => void   // hands the URL to the existing import flow
  disabled?: boolean
}

export function GitHubRepoBrowser({ onPick, disabled }: GitHubRepoBrowserProps) {
  const [status, setStatus] = useState<"loading" | "disconnected" | "connected">("loading")
  const [login, setLogin] = useState<string | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [q, setQ] = useState("")
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 1. Check connection
  useEffect(() => {
    fetch("/api/github/status")
      .then((r) => r.json())
      .then((d: { connected: boolean; login?: string | null }) => {
        setStatus(d.connected ? "connected" : "disconnected")
        setLogin(d.login ?? null)
      })
      .catch(() => setStatus("disconnected"))
  }, [])

  // 2. Load repos when connected / page / query changes
  const loadRepos = useCallback((p: number, query: string) => {
    setLoadingRepos(true); setError(null)
    const params = new URLSearchParams({ page: String(p), ...(query ? { q: query } : {}) })
    fetch(`/api/github/repos?${params}`)
      .then(async (r) => {
        if (r.status === 401) { setStatus("disconnected"); throw new Error("expired") }
        if (!r.ok) throw new Error("load")
        return r.json()
      })
      .then((d: { repos: Repo[]; hasNext: boolean }) => {
        setRepos((prev) => (p === 1 ? d.repos : [...prev, ...d.repos]))
        setHasNext(d.hasNext)
      })
      .catch((e) => { if ((e as Error).message !== "expired") setError("Couldn't load repositories.") })
      .finally(() => setLoadingRepos(false))
  }, [])

  useEffect(() => { if (status === "connected") loadRepos(1, "") }, [status, loadRepos])

  // Debounced search
  useEffect(() => {
    if (status !== "connected") return
    const t = setTimeout(() => { setPage(1); loadRepos(1, q) }, 300)
    return () => clearTimeout(t)
  }, [q, status, loadRepos])

  if (status === "loading") {
    return <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-copy-muted" /></div>
  }

  if (status === "disconnected") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="h-10 w-10 rounded-full bg-[rgba(29,224,231,0.12)] flex items-center justify-center">
          <Github className="h-5 w-5 text-[#1DE0E7]" />
        </div>
        <p className="text-xs text-copy-muted leading-relaxed max-w-[16rem]">
          Connect your GitHub account to import from your own public and private repos.
          Syntropy only reads structure — it never writes to your code.
        </p>
        {/* Path B: link to /api/github/connect. Path A: trigger Clerk connect flow. */}
        <a href="/api/github/connect">
          <Button size="sm" className="text-xs h-7 border-0"
            style={{ background: "linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)", color: "#fff" }}>
            <Github className="h-3.5 w-3.5 mr-1.5" /> Connect GitHub
          </Button>
        </a>
      </div>
    )
  }

  // connected
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-subtle border border-surface-border">
          <Search className="h-3.5 w-3.5 text-copy-muted shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${login ? login + "'s " : ""}repos…`}
            className="flex-1 bg-transparent text-xs text-copy-primary placeholder:text-copy-muted outline-none" />
        </div>
        <button onClick={() => { setPage(1); loadRepos(1, q) }} className="p-1.5 rounded text-copy-muted hover:text-copy-primary" aria-label="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <p className="text-[10px] text-red-400 px-1">{error}</p>}

      <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
        {repos.map((repo) => (
          <button key={repo.id} disabled={disabled} onClick={() => onPick(repo.url)}
            className="text-left flex items-start gap-2.5 px-3 py-2 rounded-lg bg-elevated border border-surface-border hover:border-[rgba(29,224,231,0.3)] transition-colors disabled:opacity-40">
            <Github className="h-3.5 w-3.5 text-[#1DE0E7] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-copy-primary truncate">{repo.name}</span>
                {repo.isPrivate && <Lock className="h-2.5 w-2.5 text-copy-muted shrink-0" />}
                {repo.isFork && <GitFork className="h-2.5 w-2.5 text-copy-muted shrink-0" />}
              </div>
              {repo.description && <p className="text-[10px] text-copy-muted truncate mt-0.5">{repo.description}</p>}
              <div className="flex items-center gap-2 mt-1 text-[10px] text-copy-muted">
                {repo.language && <span>{repo.language}</span>}
                {repo.stars > 0 && <span className="flex items-center gap-0.5"><Star className="h-2.5 w-2.5" />{repo.stars}</span>}
              </div>
            </div>
          </button>
        ))}
        {loadingRepos && <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-copy-muted" /></div>}
        {!loadingRepos && hasNext && (
          <button onClick={() => { const n = page + 1; setPage(n); loadRepos(n, q) }}
            className="text-[11px] text-[#1DE0E7] py-2 hover:underline">Load more</button>
        )}
        {!loadingRepos && repos.length === 0 && <p className="text-xs text-copy-muted text-center py-6">No repositories found.</p>}
      </div>
    </div>
  )
}
```

---

## Wire the browser into the modal

Modify `github-import-modal.tsx` (from 34) to offer two modes via a tab strip — keep the URL paste, add "My repos":

```tsx
import { GitHubRepoBrowser } from "@/components/editor/github-repo-browser"
// add: const [tab, setTab] = useState<"url" | "repos">("url")

// In the idle body, above the URL input:
<div className="flex gap-1 mb-1">
  <button onClick={() => setTab("url")}
    className={`text-[11px] px-2 py-1 rounded ${tab === "url" ? "bg-[rgba(29,224,231,0.12)] text-[#1DE0E7]" : "text-copy-muted"}`}>Paste URL</button>
  <button onClick={() => setTab("repos")}
    className={`text-[11px] px-2 py-1 rounded ${tab === "repos" ? "bg-[rgba(29,224,231,0.12)] text-[#1DE0E7]" : "text-copy-muted"}`}>My repos</button>
</div>

{tab === "url" ? (
  /* existing URL input + mode toggle */
) : (
  <GitHubRepoBrowser
    disabled={busy}
    onPick={(repoUrl) => { setUrl(repoUrl); startImportWith(repoUrl) }}
  />
)}
```

Add a small helper so a picked repo imports immediately without round-tripping through input state:

```tsx
const startImportWith = useCallback(async (repoUrl: string) => {
  // identical to startImport() but uses the passed repoUrl instead of `url` state
}, [roomId, projectId, mode, hasExistingNodes, onOpenChange])
```

Everything downstream — `/api/github/import`, the task, the realtime subscription, the canvas mutation — is **unchanged** from Phase 1. The repo browser is purely an alternative way to produce the same `repoUrl`. Because Phase 2 modified the import route to attach the user's token (see 36), private repos picked here import correctly; public URLs pasted in the other tab still work tokenlessly.

---

## Handling the OAuth return (`?github=connected|error`)

The custom callback redirects to `/editor?github=connected`. Optionally surface a toast and refresh the browser's status. Minimal version — in the editor page or workspace client:

```tsx
useEffect(() => {
  const p = new URLSearchParams(window.location.search).get("github")
  if (p === "connected" || p === "error") {
    // optional toast; then clean the URL
    window.history.replaceState({}, "", window.location.pathname)
  }
}, [])
```

(Not needed on Path A if you use Clerk's in-place connect flow.)

---

## End-to-end test checklist (Phase 2)

- [ ] Not connected → modal "My repos" tab shows Connect CTA.
- [ ] Connect flow completes → returns to editor → status flips to connected.
- [ ] Repo list loads, sorted by recently pushed; private repos show a lock badge.
- [ ] Search filters; "Load more" paginates.
- [ ] Pick a **private** repo → imports successfully (token attached server-side).
- [ ] Pick a **public** repo → imports successfully.
- [ ] Paste a public URL in the other tab (third-party repo) → still works.
- [ ] Revoke access on GitHub, then import → "connection expired, reconnect".
- [ ] Disconnect → status flips back to disconnected.
- [ ] Token never appears in any client network response (inspect `/api/github/repos`, `/status`).

---

## Done

Both phases share one analysis pipeline, one task, one canvas-mutation path, and one import endpoint. Phase 2 added only: a token source, three small read APIs, and a picker UI. The architecture diagram a user gets from pasting a URL is identical to the one they get from picking a private repo — which is exactly the design goal.
