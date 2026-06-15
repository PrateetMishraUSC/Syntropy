"use client"

import { useState, useEffect, useCallback } from "react"
import { GitBranch, Lock, GitFork, Star, Loader2, Search, RefreshCw } from "lucide-react"
import { useUser } from "@clerk/nextjs"
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
  const { user } = useUser()
  const [status, setStatus] = useState<"loading" | "disconnected" | "connected">("loading")
  const [login, setLogin] = useState<string | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [q, setQ] = useState("")
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 1. Check connection. setState only happens in async callbacks (not
  // synchronously in an effect body), and status starts as "loading".
  const checkStatus = useCallback(() => {
    fetch("/api/github/status")
      .then((r) => r.json())
      .then((d: { connected: boolean; login?: string | null }) => {
        setStatus(d.connected ? "connected" : "disconnected")
        setLogin(d.login ?? null)
      })
      .catch(() => setStatus("disconnected"))
  }, [])

  useEffect(() => { checkStatus() }, [checkStatus])

  // 2. Load repos when connected / page / query changes
  const loadRepos = useCallback((p: number, query: string) => {
    setLoadingRepos(true); setError(null); setPage(p)
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

  // Initial load (when connected) + debounced search. loadRepos(1, …) resets
  // pagination internally, so this covers both the first fetch and re-queries.
  useEffect(() => {
    if (status !== "connected") return
    const t = setTimeout(() => { loadRepos(1, q) }, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, status, loadRepos])

  // Path A: connect GitHub in-place via Clerk, then re-check status on return.
  const connect = useCallback(async () => {
    if (!user) return
    setError(null); setConnecting(true)
    try {
      const redirectUrl = window.location.href
      const externalAccount = await user.createExternalAccount({
        strategy: "oauth_github",
        redirectUrl,
      })
      const verificationUrl = externalAccount.verification?.externalVerificationRedirectURL
      if (verificationUrl) {
        window.location.href = verificationUrl.toString()
        return
      }
      // No redirect needed (already verified) — refresh and re-check.
      await user.reload()
      setStatus("loading")
      checkStatus()
    } catch {
      setError("Couldn't start the GitHub connection. Please try again.")
    } finally {
      setConnecting(false)
    }
  }, [user, checkStatus])

  if (status === "loading") {
    return <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-copy-muted" /></div>
  }

  if (status === "disconnected") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="h-10 w-10 rounded-full bg-[rgba(29,224,231,0.12)] flex items-center justify-center">
          <GitBranch className="h-5 w-5 text-[#1DE0E7]" />
        </div>
        <p className="text-xs text-copy-muted leading-relaxed max-w-[16rem]">
          Connect your GitHub account to import from your own public and private repos.
          Syntropy only reads structure — it never writes to your code.
        </p>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
        <Button size="sm" onClick={connect} disabled={connecting || !user}
          className="text-xs h-7 border-0"
          style={{ background: "linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)", color: "#fff",cursor:"pointer" }}>
          {connecting
            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Connecting…</>
            : <><GitBranch className="h-3.5 w-3.5 mr-1.5" /> Connect GitHub</>}
        </Button>
      </div>
    )
  }

  // connected
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-subtle border border-surface-border">
          <Search className="h-3.5 w-3.5 text-copy-muted shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${login ? login + "'s " : ""}repos…`}
            className="flex-1 bg-transparent text-xs text-copy-primary placeholder:text-copy-muted outline-none" />
        </div>
        <button onClick={() => loadRepos(1, q)} className="p-1.5 rounded text-copy-muted hover:text-copy-primary" style={{cursor:"pointer"}} aria-label="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <p className="text-[10px] text-red-400 px-1">{error}</p>}

      <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
        {repos.map((repo) => (
          <button key={repo.id} disabled={disabled} onClick={() => onPick(repo.url)}
            className="w-full min-w-0 text-left flex items-start gap-2.5 px-3 py-2 rounded-lg bg-elevated border border-surface-border hover:border-[rgba(29,224,231,0.3)] transition-colors disabled:opacity-40" style={{cursor:"pointer"}}>
            <GitBranch className="h-3.5 w-3.5 text-[#1DE0E7] shrink-0 mt-0.5" />
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
          <button onClick={() => loadRepos(page + 1, q)}
            className="text-[11px] text-[#1DE0E7] py-2 hover:underline">Load more</button>
        )}
        {!loadingRepos && repos.length === 0 && <p className="text-xs text-copy-muted text-center py-6">No repositories found.</p>}
      </div>
    </div>
  )
}
