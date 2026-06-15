# Repo Import Frontend — Import Modal + Navbar Wiring (Phase 1)

Two changes:
1. New `components/editor/github-import-modal.tsx`.
2. Wire a navbar button + modal state into `components/editor/workspace-client.tsx`.

The modal subscribes to the run with the **same** `useRealtimeRun` hook the AI sidebar uses, so progress UX is consistent with AI Architect.

---

## Design goals

- One field, zero friction. Paste URL → Import. Validate on the client before firing.
- Live progress driven by `run.metadata.status` / `run.metadata.message` (exactly what `RunSubscriber` reads in `ai-sidebar.tsx`).
- Auto-close on `done`; keep open with a clear message on `error`.
- A "Replace canvas / Add to canvas" choice shown only when the canvas already has nodes.
- Match the existing visual language: cyan accent `#1DE0E7`, gradient button, `bg-card`/`border-surface-border` tokens, lucide icons.

---

## `components/editor/github-import-modal.tsx`

```tsx
"use client"

import { useState, useCallback, useEffect } from "react"
import { Github, Loader2, AlertCircle, CheckCircle2, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { useStorage } from "@liveblocks/react"
import type { githubAnalyzer } from "@/trigger/github-analyzer"
import { parseGitHubUrl } from "@/lib/github"   // pure fn, safe in client bundle

interface GitHubImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
  projectId: string
}

// Renders nothing; bridges Trigger.dev realtime → parent callbacks.
function ImportRunSubscriber({
  runId, accessToken, onStatus, onDone,
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
  }, [run?.status, run?.metadata]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export function GitHubImportModal({ open, onOpenChange, roomId, projectId }: GitHubImportModalProps) {
  const liveNodes = useStorage((root) => root.flow.nodes)
  const hasExistingNodes = !!liveNodes && Object.keys(liveNodes as Record<string, unknown>).length > 0

  const [url, setUrl] = useState("")
  const [mode, setMode] = useState<"append" | "replace">("append")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [phase, setPhase] = useState<"idle" | "starting" | "running" | "done" | "error">("idle")
  const [statusMsg, setStatusMsg] = useState<string>("")
  const [runId, setRunId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  const reset = useCallback(() => {
    setUrl(""); setValidationError(null); setPhase("idle")
    setStatusMsg(""); setRunId(null); setToken(null); setMode("append")
  }, [])

  // Reset whenever the modal is freshly opened.
  useEffect(() => { if (open) reset() }, [open, reset])

  const startImport = useCallback(async () => {
    const parsed = parseGitHubUrl(url)
    if (!parsed) { setValidationError("Enter a valid GitHub repo URL, e.g. github.com/owner/repo"); return }
    setValidationError(null)
    setPhase("starting")
    setStatusMsg("Starting import…")
    try {
      const res = await fetch("/api/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, roomId, projectId, mode: hasExistingNodes ? mode : "append" }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed to start import" }))
        throw new Error(error ?? "Failed to start import")
      }
      const { runId: id, publicToken } = (await res.json()) as { runId: string; publicToken: string | null }
      if (!id || !publicToken) {
        // Triggered but no realtime token — close optimistically; canvas will still update.
        setPhase("done"); setStatusMsg("Import started…")
        setTimeout(() => onOpenChange(false), 1500)
        return
      }
      setRunId(id); setToken(publicToken); setPhase("running")
    } catch (e) {
      setPhase("error"); setStatusMsg((e as Error).message)
    }
  }, [url, roomId, projectId, mode, hasExistingNodes, onOpenChange])

  const busy = phase === "starting" || phase === "running"

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="max-w-md w-full bg-base border-surface-border p-0 gap-0" showCloseButton={!busy}>
        <DialogHeader className="px-5 py-4 border-b border-surface-border">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-copy-primary">
            <Github className="h-4 w-4 text-[#1DE0E7]" />
            Import from GitHub
          </DialogTitle>
          <p className="text-[11px] text-copy-muted mt-0.5">
            Paste a public repository URL to generate its architecture.
          </p>
        </DialogHeader>

        <div className="px-5 py-4 flex flex-col gap-3">
          {(phase === "idle" || phase === "error") && (
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

              {hasExistingNodes && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-copy-muted">This canvas has content:</span>
                  <button
                    onClick={() => setMode("append")}
                    className={`px-2 py-0.5 rounded ${mode === "append" ? "bg-[rgba(29,224,231,0.12)] text-[#1DE0E7]" : "text-copy-muted"}`}
                  >Add to canvas</button>
                  <button
                    onClick={() => setMode("replace")}
                    className={`px-2 py-0.5 rounded ${mode === "replace" ? "bg-[rgba(29,224,231,0.12)] text-[#1DE0E7]" : "text-copy-muted"}`}
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
            <Button size="sm" variant="outline" className="text-xs h-7 border-surface-border text-copy-muted"
              onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" className="text-xs h-7 border-0"
              style={{ background: "linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)", color: "#fff" }}
              disabled={!url.trim()} onClick={startImport}>
              {phase === "error" ? "Retry" : "Import"}
            </Button>
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
```

### Important: keep `parseGitHubUrl` client-safe

`lib/github.ts` exports both the pure `parseGitHubUrl` (safe in a client bundle) and the `GitHubClient` (server-only — uses `fetch` against the API with the secret token). `parseGitHubUrl` touches no secrets, so importing it into the client component is fine. **Do not** import `GitHubClient` or `lib/repo-analysis.ts` (which pulls the client) into any `"use client"` file.

---

## Wire into `components/editor/workspace-client.tsx`

Three small edits inside the existing `WorkspaceContent`:

1. Import the modal + an icon:
```tsx
import { Github } from "lucide-react"
import { GitHubImportModal } from "@/components/editor/github-import-modal"
```

2. Add state next to the other modal states (near `templatesOpen`):
```tsx
const [githubOpen, setGithubOpen] = useState(false)
```

3. Add a button to `navActions` (place it just before the Templates button):
```tsx
<Button variant="ghost" size="sm" className="gap-1.5 text-xs" style={{ cursor: "pointer" }}
  onClick={() => setGithubOpen(true)}>
  <Github className="h-3.5 w-3.5" />
  Import
</Button>
```

4. Render the modal alongside the others (next to `<StarterTemplatesModal …>`):
```tsx
<GitHubImportModal
  open={githubOpen}
  onOpenChange={setGithubOpen}
  roomId={roomId}
  projectId={projectId}
/>
```

That's it — `roomId` and `projectId` are already in scope in `WorkspaceContent`, and the modal lives inside the `RoomProvider`, so `useStorage`/`useRealtimeRun` work.

---

## Error-state matrix (what the user sees)

| Cause | Where caught | Message |
|-------|--------------|---------|
| Empty / malformed URL | client `parseGitHubUrl` | "Enter a valid GitHub repo URL, e.g. github.com/owner/repo" |
| Not signed in | `/api/github/import` 401 | falls into generic "Failed to start import" (shouldn't happen in-app) |
| No project access | route 403 | "Failed to start import" |
| Private repo (no token visibility) | task → `not_found` | "Repository not found. If it's private, connect your GitHub account." |
| Rate limited | task → `rate_limited` | "GitHub rate limit reached. Please try again in a minute." |
| Empty repo | task → `empty` | "This repository looks empty." |
| LLM/canvas failure | task throws | "Import failed. Please try again." (Trigger.dev retries first) |

---

## Manual test checklist

- [ ] Import `github.com/gothinkster/realworld` → multiple services appear.
- [ ] Import a tiny single-file repo → minimal but valid diagram.
- [ ] Import a private repo URL → "connect your GitHub account" message (sets up Phase 2).
- [ ] Import with existing canvas content → "Add / Replace" toggle appears and is honored.
- [ ] A second collaborator in the same room sees nodes stream in live.
- [ ] After import, run AI Architect on the result and generate a spec — both work on the imported diagram.

**Phase 1 complete.** Proceed to `35-github-account-connect.md`.
