"use client"

import { useState, useCallback, useEffect } from "react"
import { GitBranch, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { useStorage } from "@liveblocks/react"
import type { githubAnalyzer } from "@/trigger/github-analyzer"
import { parseGitHubUrl } from "@/lib/github"
import { GitHubRepoBrowser } from "@/components/editor/github-repo-browser"

interface GitHubImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
  projectId: string
}

function ImportRunSubscriber({
  runId,
  accessToken,
  onStatus,
  onDone,
}: {
  runId: string
  accessToken: string
  onStatus: (status: string, message: string) => void
  onDone: (succeeded: boolean, summary?: string) => void
}) {
  const { run } = useRealtimeRun<typeof githubAnalyzer>(runId, { accessToken })
  useEffect(() => {
    if (!run) return
    const s = run.metadata?.status as string | undefined
    const m = run.metadata?.message as string | undefined
    if (s && m) onStatus(s, m)
    if (run.status === "COMPLETED") {
      onDone(true, (run.output as { summary?: string } | undefined)?.summary)
    } else if (run.status === "FAILED" || run.status === "CRASHED" || run.status === "CANCELED") {
      onDone(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, run?.metadata])
  return null
}

export function GitHubImportModal({ open, onOpenChange, roomId, projectId }: GitHubImportModalProps) {
  const liveNodes = useStorage((root) => root.flow.nodes)
  const hasExistingNodes = !!liveNodes && Object.keys(liveNodes).length > 0

  const [url, setUrl] = useState("")
  const [tab, setTab] = useState<"url" | "repos">("url")
  const [mode, setMode] = useState<"append" | "replace">("append")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [phase, setPhase] = useState<"idle" | "starting" | "running" | "done" | "error">("idle")
  const [statusMsg, setStatusMsg] = useState<string>("")
  const [runId, setRunId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  const reset = useCallback(() => {
    setUrl(""); setTab("url"); setValidationError(null); setPhase("idle")
    setStatusMsg(""); setRunId(null); setToken(null); setMode("append")
  }, [])

  useEffect(() => { if (open) reset() }, [open, reset])

  const startImportWith = useCallback(async (repoUrl: string) => {
    const parsed = parseGitHubUrl(repoUrl)
    if (!parsed) {
      setValidationError("Enter a valid GitHub repo URL, e.g. github.com/owner/repo")
      return
    }
    setValidationError(null)
    setPhase("starting")
    setStatusMsg("Starting import…")
    try {
      const res = await fetch("/api/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: repoUrl, roomId, projectId, mode: hasExistingNodes ? mode : "append" }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed to start import" }))
        throw new Error(error ?? "Failed to start import")
      }
      const { runId: id, publicToken } = (await res.json()) as { runId: string; publicToken: string | null }
      if (!id || !publicToken) {
        setPhase("done"); setStatusMsg("Import started…")
        setTimeout(() => onOpenChange(false), 1500)
        return
      }
      setRunId(id); setToken(publicToken); setPhase("running")
    } catch (e) {
      setPhase("error"); setStatusMsg((e as Error).message)
    }
  }, [roomId, projectId, mode, hasExistingNodes, onOpenChange])

  const startImport = useCallback(() => startImportWith(url), [startImportWith, url])

  const busy = phase === "starting" || phase === "running"

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent
        className="max-w-md w-full border-surface-border p-0 gap-0 overflow-hidden"
        style={{ background: "rgba(8,8,9,0.72)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      >
        <DialogHeader className="px-5 py-4 border-b border-surface-border">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-copy-primary">
            <GitBranch className="h-4 w-4 text-[#1DE0E7]" />
            Import from GitHub
          </DialogTitle>
          <p className="text-[11px] text-copy-muted mt-0.5">
            Paste a public repo URL, or connect GitHub to import your own public and private repos.
          </p>
        </DialogHeader>

        <div className="px-5 py-4 flex flex-col gap-3 min-w-0">
          {(phase === "idle" || phase === "error") && (
            <>
              <div className="flex gap-1">
                <button
                  onClick={() => setTab("url")}
                  style={{cursor: "pointer"}}
                  className={`text-[11px] px-2 py-1 rounded ${tab === "url" ? "bg-[rgba(29,224,231,0.12)] text-[#1DE0E7]" : "text-copy-muted hover:text-copy-primary"}`}
                >Paste URL</button>
                <button
                  onClick={() => setTab("repos")}
                  style={{cursor: "pointer"}}
                  className={`text-[11px] px-2 py-1 rounded ${tab === "repos" ? "bg-[rgba(29,224,231,0.12)] text-[#1DE0E7]" : "text-copy-muted hover:text-copy-primary"}`}
                >My repos</button>
              </div>

              {tab === "repos" && (
                <GitHubRepoBrowser
                  disabled={busy}
                  onPick={(repoUrl) => { setUrl(repoUrl); startImportWith(repoUrl) }}
                />
              )}

              {tab === "url" && (
              <>
              <input
                autoFocus
                value={url}
                onChange={(e) => { setUrl(e.target.value); setValidationError(null) }}
                onKeyDown={(e) => { if (e.key === "Enter") startImport() }}
                placeholder="https://github.com/owner/repo"
                className="w-full text-xs px-3 py-2 rounded-md bg-subtle border border-surface-border text-copy-primary placeholder:text-copy-muted focus:border-[rgba(29,224,231,0.4)] outline-none"
              />
              {validationError && (
                <p className="text-[10px] text-red-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {validationError}
                </p>
              )}
              </>
              )}

              {hasExistingNodes && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-copy-muted">This canvas has content:</span>
                  <button
                    onClick={() => setMode("append")}
                    className={`px-2 py-0.5 rounded ${mode === "append" ? "bg-[rgba(29,224,231,0.12)] text-[#1DE0E7]" : "text-copy-muted"}`}
                    style={{cursor: "pointer"}}
                  >Add to canvas</button>
                  <button
                    onClick={() => setMode("replace")}
                    className={`px-2 py-0.5 rounded ${mode === "replace" ? "bg-[rgba(29,224,231,0.12)] text-[#1DE0E7]" : "text-copy-muted"}`}
                    style={{cursor: "pointer"}}
                  >Replace</button>
                </div>
              )}

              {phase === "error" && (
                <div className="flex items-start gap-2 text-[11px] text-red-400 bg-[rgba(239,68,68,0.08)] rounded-md px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{statusMsg}</span>
                </div>
              )}
            </>
          )}

          {busy && (
            <div className="flex items-center gap-2.5 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-[#1DE0E7] shrink-0" />
              <span className="text-xs text-copy-secondary">{statusMsg || "Working…"}</span>
            </div>
          )}

          {phase === "done" && (
            <div className="flex items-center gap-2.5 py-3">
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
              <span className="text-xs text-copy-secondary">{statusMsg || "Done!"}</span>
            </div>
          )}
        </div>

        {(phase === "idle" || phase === "error") && (
          <div className="px-5 py-3 border-t border-surface-border flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 border-surface-border text-copy-muted"
              onClick={() => onOpenChange(false)}
              style={{cursor: "pointer"}}
            >
              Cancel
            </Button>
            {(tab === "url" || phase === "error") && (
              <Button
                size="sm"
                className="text-xs h-7 border-0"
                style={{ background: "linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)", color: "#fff", cursor:"pointer"}}
                disabled={!url.trim()}
                onClick={startImport}
              >
                {phase === "error" ? "Retry" : "Import"}
              </Button>
            )}
          </div>
        )}

        {runId && token && (
          <ImportRunSubscriber
            runId={runId}
            accessToken={token}
            onStatus={(_s, m) => setStatusMsg(m)}
            onDone={(ok, summary) => {
              if (ok) {
                setPhase("done"); setStatusMsg(summary ?? "Architecture imported!")
                setTimeout(() => onOpenChange(false), 1500)
              } else {
                setPhase("error")
                setStatusMsg((prev) => prev || "Import failed. Please try again.")
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
