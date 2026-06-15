"use client"

import { useState, useCallback } from "react"
import { Share2, Bot, LayoutTemplate, Loader2, Check, AlertCircle, GitBranch } from "lucide-react"
import { LiveblocksProvider, RoomProvider, useOthers } from "@liveblocks/react"
import { LiveObject, LiveMap } from "@liveblocks/client"
import { useUser } from "@clerk/nextjs"
import type { SaveStatus } from "@/hooks/use-canvas-autosave"
import { EditorNavbar } from "@/components/editor/editor-navbar"
import { ProjectSidebar } from "@/components/editor/project-sidebar"
import { ProjectDialogs } from "@/components/editor/project-dialogs"
import { ShareDialog } from "@/components/editor/share-dialog"
import { CanvasRoom } from "@/components/editor/canvas-room"
import { StarterTemplatesModal } from "@/components/editor/starter-templates-modal"
import { GitHubImportModal } from "@/components/editor/github-import-modal"
import { AISidebar } from "@/components/editor/ai-sidebar"
import { ShortcutsPopover } from "@/components/editor/shortcuts-popover"
import { Button } from "@/components/ui/button"
import { useProjectActions } from "@/hooks/use-project-actions"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import type { ProjectRef } from "@/lib/projects"
import type { CanvasTemplate } from "@/components/editor/starter-templates"

interface WorkspaceClientProps {
  projectName: string
  roomId: string
  projectId: string
  ownedProjects: ProjectRef[]
  sharedProjects: ProjectRef[]
}

// ---------- presence bar ----------

function PresenceAvatar({
  displayName,
  avatarUrl,
  color,
  isYou,
  offsetIndex,
}: {
  displayName: string
  avatarUrl?: string
  color: string
  isYou?: boolean
  offsetIndex: number
}) {
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?"

  return (
    <div
      title={isYou ? `${displayName} (You)` : displayName}
      style={{
        position: "relative",
        width: 26,
        height: 26,
        borderRadius: "50%",
        border: `2px solid ${isYou ? "rgba(255,255,255,0.25)" : color}`,
        overflow: "visible",
        flexShrink: 0,
        marginLeft: offsetIndex > 0 ? -6 : 0,
        zIndex: 10 - offsetIndex,
        opacity: isYou ? 0.7 : 1,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          overflow: "hidden",
          background: `${color}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.6rem",
          fontWeight: 700,
          color: "#fff",
        }}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={displayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          initials
        )}
      </div>
      {/* Live pulse dot — only for other collaborators */}
      {!isYou && (
        <span
          style={{
            position: "absolute",
            bottom: -1,
            right: -1,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#22c55e",
            border: "1.5px solid #111114",
          }}
        />
      )}
    </div>
  )
}

function PresenceBar() {
  const others = useOthers()
  const { user } = useUser()

  const visible = others.slice(0, 4)
  const overflow = others.length > 4 ? others.length - 4 : 0

  return (
    <div className="flex items-center" style={{ gap: 0 }}>
      {/* Other collaborators */}
      {visible.map((other, i) => (
        <PresenceAvatar
          key={other.connectionId}
          displayName={other.info?.displayName ?? "User"}
          avatarUrl={other.info?.avatarUrl}
          color={other.info?.cursorColor ?? "#6366f1"}
          offsetIndex={i}
        />
      ))}

      {overflow > 0 && (
        <div
          title={`${overflow} more collaborators`}
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.55rem",
            fontWeight: 700,
            color: "rgba(255,255,255,0.6)",
            flexShrink: 0,
            marginLeft: -6,
            zIndex: 5,
          }}
        >
          +{overflow}
        </div>
      )}

      {/* Divider — only when there are other collaborators */}
      {others.length > 0 && (
        <div
          style={{
            width: 1,
            height: 16,
            background: "rgba(255,255,255,0.15)",
            margin: "0 6px",
            flexShrink: 0,
          }}
        />
      )}

      {/* Current user — plain avatar, no dropdown */}
      {user && (
        <PresenceAvatar
          displayName={user.fullName ?? user.primaryEmailAddress?.emailAddress ?? "You"}
          avatarUrl={user.imageUrl}
          color="rgba(255,255,255,0.4)"
          isYou
          offsetIndex={0}
        />
      )}
    </div>
  )
}

// ---------- save indicator ----------

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null
  return (
    <span
      className="flex items-center gap-1 text-xs"
      style={{
        color:
          status === "error"
            ? "rgba(239,68,68,0.8)"
            : status === "saved"
              ? "rgba(134,239,172,0.8)"
              : "rgba(255,255,255,0.4)",
      }}
    >
      {status === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "saved" && <Check className="h-3 w-3" />}
      {status === "error" && <AlertCircle className="h-3 w-3" />}
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save error"}
    </span>
  )
}

// ---------- inner workspace (has access to Liveblocks context) ----------

function WorkspaceContent({
  projectName,
  roomId,
  projectId,
  ownedProjects,
  sharedProjects,
}: WorkspaceClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<CanvasTemplate | null>(null)
  const [githubOpen, setGithubOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const actions = useProjectActions()

  const handleSaveStatus = useCallback((status: SaveStatus) => {
    setSaveStatus(status)
  }, [])

  useKeyboardShortcuts({
    toggleSidebar: () => setSidebarOpen((v) => !v),
    toggleAI: () => setAiOpen((v) => !v),
  })

  const navActions = (
    <>
      <PresenceBar />
      <SaveIndicator status={saveStatus} />
      <Button variant="ghost" size="sm" className="gap-1.5 text-xs" style={{cursor: "pointer"}} onClick={() => setGithubOpen(true)}>
        <GitBranch className="h-3.5 w-3.5" />
        Import
      </Button>
      <Button variant="ghost" size="sm" className="gap-1.5 text-xs" style={{cursor: "pointer"}} onClick={() => setTemplatesOpen(true)}>
        <LayoutTemplate className="h-3.5 w-3.5" />
        Templates
      </Button>
      <Button variant="ghost" size="sm" className="gap-1.5 text-xs" style={{cursor: "pointer"}} onClick={() => setShareOpen(true)}>
        <Share2 className="h-3.5 w-3.5" />
        Share
      </Button>
      <ShortcutsPopover />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setAiOpen((v) => !v)}
        aria-label="Toggle AI sidebar"
        aria-expanded={aiOpen}
        style={{ cursor: "pointer" }}
      >
        <Bot className="h-4 w-4" />
      </Button>
    </>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden dot-grid">
      <EditorNavbar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        title={projectName}
        actions={navActions}
      />

      <ProjectSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenCreate={actions.openCreate}
        onRename={actions.openRename}
        onDelete={actions.openDelete}
        ownedProjects={ownedProjects}
        sharedProjects={sharedProjects}
        activeRoomId={roomId}
      />

      <main className="relative mt-12 flex-1 overflow-hidden dot-grid">
        <CanvasRoom
          projectId={projectId}
          pendingTemplate={pendingTemplate}
          onTemplateConsumed={() => setPendingTemplate(null)}
          onSaveStatusChange={handleSaveStatus}
        />
      </main>

      <AISidebar isOpen={aiOpen} onClose={() => setAiOpen(false)} roomId={roomId} projectId={projectId} />

      <GitHubImportModal
        open={githubOpen}
        onOpenChange={setGithubOpen}
        roomId={roomId}
        projectId={projectId}
      />

      <StarterTemplatesModal
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onImport={(template) => setPendingTemplate(template)}
      />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        roomId={roomId}
        projectName={projectName}
      />

      <ProjectDialogs
        dialog={actions.dialog}
        activeProject={actions.activeProject}
        nameInput={actions.nameInput}
        setNameInput={actions.setNameInput}
        slugPreview={actions.slugPreview}
        loading={actions.loading}
        onClose={actions.close}
        onCreate={actions.createProject}
        onRename={actions.renameProject}
        onDelete={actions.deleteProject}
      />
    </div>
  )
}

// ---------- exported shell (owns providers) ----------

export function WorkspaceClient(props: WorkspaceClientProps) {
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={props.roomId}
        initialPresence={{ cursor: null, thinking: false }}
        initialStorage={{
          flow: new LiveObject({
            nodes: new LiveMap(),
            edges: new LiveMap(),
          }),
        }}
      >
        <WorkspaceContent {...props} />
      </RoomProvider>
    </LiveblocksProvider>
  )
}
