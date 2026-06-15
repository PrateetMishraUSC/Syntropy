"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { Bot, X, FileText, Download, Loader2, AlertCircle } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import ReactMarkdown from "react-markdown"
import {
  useEventListener,
  useCreateFeed,
  useCreateFeedMessage,
  useFeedMessages,
  useUpdateFeedMessage,
  useSelf,
  useStorage,
} from "@liveblocks/react"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { cn } from "@/lib/utils"
import type { designAgent } from "@/trigger/design-agent"
import { AiStatusFeedPayloadSchema, ChatMessageSchema } from "@/types/tasks"
import type { ChatMessage } from "@/types/tasks"

interface DisplayMessage {
  id: string
  role: "user" | "assistant"
  sender: string
  content: string
  timestamp: number
  isLoading?: boolean
}

const STARTER_CHIPS = [
  "Design a high scale e-commerce website system with an API gateway, CDNs, Redis Cache, Read and Write Services, and a NoSQL DB.",
  "Design a real-time messaging platform with WebSocket servers, message queues, Kafka, and a distributed database.",
  "Build a microservices architecture for a video streaming platform with transcoding workers, CDN, and object storage.",
]

interface ProjectSpec {
  id: string
  filePath: string
  createdAt: string
}

function specFilename(spec: ProjectSpec): string {
  try {
    const url = new URL(spec.filePath)
    return url.pathname.split("/").pop() ?? `${spec.id}.md`
  } catch {
    return `${spec.id}.md`
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface SpecsTabProps {
  projectId: string
  roomId: string
  isActive: boolean
  chatHistory: { role: "user" | "assistant"; content: string }[]
}

function SpecRunSubscriber({
  runId,
  accessToken,
  onDone,
}: {
  runId: string
  accessToken: string
  onDone: (succeeded: boolean) => void
}) {
  const { run } = useRealtimeRun(runId, { accessToken })
  useEffect(() => {
    if (!run) return
    if (run.status === "COMPLETED") onDone(true)
    else if (run.status === "FAILED" || run.status === "CRASHED" || run.status === "CANCELED") onDone(false)
  }, [run?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function SpecsTab({ projectId, roomId, isActive, chatHistory }: SpecsTabProps) {
  const liveNodes = useStorage((root) => root.flow.nodes)
  const liveEdges = useStorage((root) => root.flow.edges)

  const [specs, setSpecs] = useState<ProjectSpec[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedSpec, setSelectedSpec] = useState<ProjectSpec | null>(null)
  const [modalContent, setModalContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generateRunId, setGenerateRunId] = useState<string | null>(null)
  const [generateToken, setGenerateToken] = useState<string | null>(null)

  const loadSpecs = useCallback(() => {
    setLoadingList(true)
    setListError(null)
    fetch(`/api/projects/${projectId}/specs`)
      .then((r) => r.json())
      .then((data: { specs?: ProjectSpec[]; error?: string }) => {
        if (data.specs) setSpecs(data.specs)
        else setListError(data.error ?? "Failed to load specs")
      })
      .catch(() => setListError("Failed to load specs"))
      .finally(() => setLoadingList(false))
  }, [projectId])

  useEffect(() => {
    if (isActive) loadSpecs()
  }, [isActive, loadSpecs])

  const handleGenerateSpec = useCallback(async () => {
    setGenerating(true)
    setGenerateError(null)
    try {
      const nodes = liveNodes ? Object.values(liveNodes as unknown as Record<string, unknown>) : []
      const edges = liveEdges ? Object.values(liveEdges as unknown as Record<string, unknown>) : []
      const res = await fetch("/api/ai/spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, chatHistory, nodes, edges }),
      })
      if (!res.ok) throw new Error("Request failed")
      const { runId, publicToken } = (await res.json()) as { runId: string; publicToken: string | null }
      if (runId && publicToken) {
        setGenerateRunId(runId)
        setGenerateToken(publicToken)
      } else {
        // Run triggered but no realtime token — poll by refreshing list after a delay
        setTimeout(loadSpecs, 8000)
        setGenerating(false)
      }
    } catch {
      setGenerateError("Failed to start generation. Please try again.")
      setGenerating(false)
    }
  }, [roomId, chatHistory, liveNodes, liveEdges, loadSpecs])

  const openSpec = useCallback(
    (spec: ProjectSpec) => {
      setSelectedSpec(spec)
      setModalContent(null)
      setContentError(null)
      setLoadingContent(true)
      fetch(`/api/projects/${projectId}/specs/${spec.id}/content`)
        .then((r) => r.json())
        .then((data: { content?: string; error?: string }) => {
          if (data.content !== undefined) setModalContent(data.content)
          else setContentError(data.error ?? "Failed to load content")
        })
        .catch(() => setContentError("Failed to load content"))
        .finally(() => setLoadingContent(false))
    },
    [projectId],
  )

  const downloadSpec = useCallback(
    async (spec: ProjectSpec, e?: React.MouseEvent) => {
      e?.stopPropagation()
      setDownloading(spec.id)
      try {
        const res = await fetch(`/api/projects/${projectId}/specs/${spec.id}/download`)
        if (!res.ok) throw new Error("Download failed")
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = specFilename(spec)
        a.click()
        URL.revokeObjectURL(url)
      } catch {
        // silently fail — the browser will show nothing downloaded
      } finally {
        setDownloading(null)
      }
    },
    [projectId],
  )

  return (
    <>
      {generateRunId && generateToken && (
        <SpecRunSubscriber
          runId={generateRunId}
          accessToken={generateToken}
          onDone={(succeeded) => {
            setGenerating(false)
            setGenerateRunId(null)
            setGenerateToken(null)
            if (succeeded) loadSpecs()
            else setGenerateError("Spec generation failed. Please try again.")
          }}
        />
      )}

      <div className="shrink-0 px-3 pt-3 pb-2">
        <Button
          size="sm"
          className="w-full text-xs border-0"
          onClick={handleGenerateSpec}
          style={{
            background: 'linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)',
            color: '#ffffff',
            cursor: "pointer",
          }}
          disabled={generating}
        >
          {generating ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating…
            </span>
          ) : (
            "Generate Spec"
          )}
        </Button>
        {generateError && (
          <p className="text-[10px] text-state-error mt-1.5 text-center">{generateError}</p>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 px-3 pb-3">
          {loadingList && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-copy-muted" />
            </div>
          )}
          {listError && (
            <div className="flex items-center gap-2 py-6 text-center justify-center">
              <AlertCircle className="h-4 w-4 text-state-error shrink-0" />
              <span className="text-xs text-copy-muted">{listError}</span>
            </div>
          )}
          {!loadingList && !listError && specs.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="h-9 w-9 rounded-full bg-elevated flex items-center justify-center">
                <FileText className="h-4 w-4 text-copy-muted" />
              </div>
              <p className="text-xs text-copy-muted leading-relaxed">
                No specs yet.
              </p>
            </div>
          )}
          {specs.map((spec) => (
            <div
              key={spec.id}
              role="button"
              tabIndex={0}
              onClick={() => openSpec(spec)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSpec(spec) } }}
              className="w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-elevated border border-surface-border hover:border-[rgba(29,224,231,0.3)] transition-colors group cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5 text-[#1DE0E7] shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-copy-primary truncate">
                  {specFilename(spec)}
                </p>
                <p className="text-[10px] text-copy-muted mt-0.5">
                  {formatDate(spec.createdAt)}
                </p>
              </div>
              <button
                onClick={(e) => downloadSpec(spec, e)}
                disabled={downloading === spec.id}
                className="shrink-0 p-1 rounded text-copy-muted hover:text-copy-primary opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
                aria-label="Download spec"
              >
                {downloading === spec.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Preview modal */}
      <Dialog open={selectedSpec !== null} onOpenChange={(open) => { if (!open) setSelectedSpec(null) }}>
        <DialogContent
          showCloseButton={true}
          className="max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col bg-base border-surface-border p-0 gap-0"
        >
          <DialogHeader className="px-5 py-4 border-b border-surface-border shrink-0">
            <DialogTitle className="text-sm font-semibold text-copy-primary truncate pr-6">
              {selectedSpec ? specFilename(selectedSpec) : ""}
            </DialogTitle>
            {selectedSpec && (
              <p className="text-[11px] text-copy-muted mt-0.5">
                {formatDate(selectedSpec.createdAt)}
              </p>
            )}
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-5 py-4">
              {loadingContent && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-copy-muted" />
                </div>
              )}
              {contentError && (
                <div className="flex items-center gap-2 py-8 justify-center">
                  <AlertCircle className="h-4 w-4 text-state-error" />
                  <span className="text-xs text-copy-muted">{contentError}</span>
                </div>
              )}
              {modalContent !== null && (
                <div className="text-sm text-copy-secondary leading-relaxed [overflow-wrap:break-word] [word-break:break-word] [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-copy-primary [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-copy-primary [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-copy-primary [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:mb-3 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:mb-1 [&_li]:text-xs [&_strong]:text-copy-primary [&_strong]:font-medium [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_code]:text-copy-primary [&_pre]:bg-elevated [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:border-surface-border [&_blockquote]:pl-3 [&_blockquote]:text-copy-muted [&_hr]:border-surface-border [&_hr]:my-4">
                  <ReactMarkdown>{modalContent}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 px-5 py-3 border-t border-surface-border flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 border-surface-border text-copy-muted hover:text-copy-primary"
              onClick={() => setSelectedSpec(null)}
            >
              Close
            </Button>
            <Button
              size="sm"
              className="text-xs h-7 border-0"
              style={{
                background: 'linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)',
                color: '#ffffff',
              }}
              disabled={!selectedSpec || downloading === selectedSpec?.id}
              onClick={() => selectedSpec && downloadSpec(selectedSpec)}
            >
              {downloading === selectedSpec?.id ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const FEED_ID = "ai-status-feed"
const CHAT_FEED_ID = "ai-chat"

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

interface AISidebarProps {
  isOpen: boolean
  onClose: () => void
  roomId: string
  projectId: string
}

function RunSubscriber({
  runId,
  accessToken,
  onStatusChange,
  onMetadataUpdate,
}: {
  runId: string
  accessToken: string
  onStatusChange: (status: string, output?: { summary?: string }) => void
  onMetadataUpdate: (status: string, message: string) => void
}) {
  const { run } = useRealtimeRun<typeof designAgent>(runId, { accessToken })

  useEffect(() => {
    if (!run) return

    const metaStatus = run.metadata?.status as string | undefined
    const metaMessage = run.metadata?.message as string | undefined
    if (metaStatus && metaMessage) {
      onMetadataUpdate(metaStatus, metaMessage)
    }

    if (run.status === "COMPLETED") {
      onStatusChange("COMPLETED", run.output as { summary?: string } | undefined)
    } else if (run.status === "FAILED" || run.status === "CRASHED" || run.status === "CANCELED") {
      onStatusChange("FAILED")
    }
  }, [run?.status, run?.metadata, onStatusChange, onMetadataUpdate]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

export function AISidebar({ isOpen, onClose, roomId, projectId }: AISidebarProps) {
  const [aiMessages, setAiMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState("")
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeToken, setActiveToken] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingMsgIdRef = useRef<string | null>(null)

  // Refs used inside useEventListener to avoid stale closures
  const isOwnerRef = useRef(false)
  const activeFeedMsgIdRef = useRef<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)

  const self = useSelf()
  const createFeed = useCreateFeed()
  const createFeedMessage = useCreateFeedMessage()
  const updateFeedMessage = useUpdateFeedMessage()
  const { messages: feedMessages } = useFeedMessages(FEED_ID)
  const { messages: chatFeedMessages } = useFeedMessages(CHAT_FEED_ID)

  // Derive shared generation state from the latest validated feed message
  const latestFeedMsg = feedMessages?.[0]
  const latestFeedPayload = latestFeedMsg?.data
    ? AiStatusFeedPayloadSchema.safeParse(latestFeedMsg.data).data ?? null
    : null
  const isGenerating = !!(
    latestFeedPayload?.status &&
    ["thinking", "processing", "applying"].includes(latestFeedPayload.status)
  )
  const sharedStatusText = isGenerating ? (latestFeedPayload?.text ?? "AI generating…") : null

  // Validate and convert ai-chat feed messages for display
  const validatedChatMessages = useMemo((): DisplayMessage[] => {
    if (!chatFeedMessages) return []
    const result: DisplayMessage[] = []
    for (const msg of chatFeedMessages) {
      if (!msg.data) continue
      const parsed = ChatMessageSchema.safeParse(msg.data)
      if (!parsed.success) continue
      result.push({
        id: msg.id,
        role: parsed.data.role as "user" | "assistant",
        sender: parsed.data.sender,
        content: parsed.data.content,
        timestamp: parsed.data.timestamp,
        isLoading: false,
      })
    }
    return result.reverse() // feed returns newest-first; reverse for chronological display
  }, [chatFeedMessages])

  // Merge collaborative chat messages with local AI loading placeholders, sorted by time
  const allMessages = useMemo(() => {
    // Exclude local placeholders that have already landed in the feed
    const feedIds = new Set(validatedChatMessages.map((m) => m.id))
    const pendingLocal = aiMessages.filter((m) => !feedIds.has(m.id))
    return [...validatedChatMessages, ...pendingLocal].sort((a, b) => a.timestamp - b.timestamp)
  }, [validatedChatMessages, aiMessages])

  // Ensure both feeds exist on mount
  useEffect(() => {
    createFeed(FEED_ID).catch(() => {})
    createFeed(CHAT_FEED_ID).catch(() => {})
  }, [createFeed])

  // Keep isOwnerRef in sync with whether this participant owns the active session
  useEffect(() => {
    isOwnerRef.current = activeRunId !== null
  }, [activeRunId])

  // Listen for AI status events broadcast from the Trigger.dev task
  useEventListener(({ event }) => {
    if (event.type !== "ai-status") return
    const { status, message, runId } = event as { status: string; message: string; runId?: string }

    // Ignore events from a different run than the one this client triggered
    if (runId && activeRunIdRef.current && runId !== activeRunIdRef.current) return

    // Update local AI response placeholder
    setAiMessages((prev) => {
      if (!pendingMsgIdRef.current) return prev
      return prev.map((m) =>
        m.id === pendingMsgIdRef.current
          ? {
              ...m,
              content: message,
              isLoading:
                status === "thinking" || status === "processing" || status === "applying",
            }
          : m,
      )
    })

    // Only the participant who triggered the session writes to the status feed
    if (isOwnerRef.current) {
      const payload = { text: message, status }
      if (activeFeedMsgIdRef.current) {
        updateFeedMessage(FEED_ID, activeFeedMsgIdRef.current, payload).catch(() => {})
      } else {
        const msgId = `ai-status-${Date.now()}`
        activeFeedMsgIdRef.current = msgId
        createFeedMessage(FEED_ID, payload, { id: msgId }).catch(() => {
          activeFeedMsgIdRef.current = null
        })
      }

      // When done, post the final AI response to the collaborative ai-chat feed
      if (status === "done") {
        const capturedPendingId = pendingMsgIdRef.current
        const finalMsg: ChatMessage = {
          sender: "AI Architect",
          role: "assistant",
          content: message,
          timestamp: Date.now(),
        }
        createFeedMessage(CHAT_FEED_ID, finalMsg)
          .then(() => {
            // Remove local placeholder — the feed version will take over
            if (capturedPendingId) {
              setAiMessages((prev) => prev.filter((m) => m.id !== capturedPendingId))
            }
          })
          .catch(() => {
            // Keep local placeholder visible if the feed post fails
            setAiMessages((prev) =>
              prev.map((m) =>
                m.id === capturedPendingId ? { ...m, isLoading: false } : m,
              ),
            )
          })
      }
    }

    if (status === "done" || status === "error") {
      pendingMsgIdRef.current = null
      activeFeedMsgIdRef.current = null
      activeRunIdRef.current = null
      isOwnerRef.current = false
      // Clean up React state even when RunSubscriber never mounted (null publicToken)
      setActiveRunId(null)
      setActiveToken(null)
      setIsSubmitting(false)
    }
  })

  const handleMetadataUpdate = useCallback((status: string, message: string) => {
    setAiMessages((prev) => {
      if (!pendingMsgIdRef.current) return prev
      return prev.map((m) =>
        m.id === pendingMsgIdRef.current
          ? { ...m, content: message, isLoading: status !== "done" && status !== "error" }
          : m,
      )
    })
    if (status === "done" || status === "error") {
      pendingMsgIdRef.current = null
      setActiveRunId(null)
      setActiveToken(null)
      setIsSubmitting(false)
    }
  }, [])

  const handleRunStatusChange = useCallback(
    (status: string, output?: { summary?: string }) => {
      if (status === "COMPLETED" && output?.summary) {
        setAiMessages((prev) => {
          if (!pendingMsgIdRef.current) return prev
          return prev.map((m) =>
            m.id === pendingMsgIdRef.current
              ? { ...m, content: output.summary!, isLoading: false }
              : m,
          )
        })
        pendingMsgIdRef.current = null
      } else if (status === "FAILED") {
        // Update the local AI message bubble
        setAiMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsgIdRef.current
              ? { ...m, content: "Something went wrong. Please try again.", isLoading: false }
              : m,
          ),
        )
        pendingMsgIdRef.current = null
        // Push the error status to the shared feed so isGenerating clears for all
        // room participants, not just the triggering user.
        const feedMsgId = activeFeedMsgIdRef.current
        if (feedMsgId) {
          updateFeedMessage(FEED_ID, feedMsgId, {
            text: "Something went wrong. Please try again.",
            status: "error",
          }).catch(() => {})
          activeFeedMsgIdRef.current = null
        }
        isOwnerRef.current = false
        activeRunIdRef.current = null
      }
      setActiveRunId(null)
      setActiveToken(null)
      setIsSubmitting(false)
    },
    [updateFeedMessage],
  )

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isSubmitting || isGenerating) return

      setChatError(null)
      const timestamp = Date.now()
      const sender = self?.info?.displayName ?? "You"
      const assistantMsgId = `a-${timestamp}`
      const assistantMsg: DisplayMessage = {
        id: assistantMsgId,
        role: "assistant",
        sender: "AI Architect",
        content: "Analyzing your request…",
        timestamp: timestamp + 1,
        isLoading: true,
      }

      pendingMsgIdRef.current = assistantMsgId
      setAiMessages((prev) => [...prev, assistantMsg])
      setInput("")
      setIsSubmitting(true)
      isOwnerRef.current = true

      if (textareaRef.current) {
        textareaRef.current.style.height = "72px"
      }

      // Post user message to the collaborative ai-chat feed (visible to all room participants)
      try {
        const chatPayload: ChatMessage = {
          sender,
          role: "user",
          content: content.trim(),
          timestamp,
        }
        await createFeedMessage(CHAT_FEED_ID, chatPayload)
      } catch {
        setChatError("Failed to send message. Please try again.")
        setAiMessages((prev) => prev.filter((m) => m.id !== assistantMsgId))
        pendingMsgIdRef.current = null
        isOwnerRef.current = false
        setIsSubmitting(false)
        return
      }

      // Trigger AI design agent
      try {
        const triggerRes = await fetch("/api/ai/design", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: content.trim(), roomId, projectId }),
        })

        if (!triggerRes.ok) {
          throw new Error("Failed to trigger design agent")
        }

        const { runId, publicToken } = (await triggerRes.json()) as { runId: string; publicToken: string }

        setActiveRunId(runId)
        setActiveToken(publicToken)
        activeRunIdRef.current = runId
      } catch {
        setAiMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: "Failed to start. Please try again.", isLoading: false }
              : m,
          ),
        )
        pendingMsgIdRef.current = null
        isOwnerRef.current = false
        setIsSubmitting(false)
      }
    },
    [isSubmitting, isGenerating, roomId, projectId, self, createFeedMessage],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    setChatError(null)
    const el = e.target
    el.style.height = "72px"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [allMessages])

  const [activeTab, setActiveTab] = useState("architect")
  const inputBlocked = isSubmitting || isGenerating

  return (
    <aside
      aria-label="AI chat"
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={cn(
        "fixed top-12 right-0 bottom-0 z-30 w-80",
        "flex flex-col bg-[#080809]/72 border-l border-white/[0.07]",
        "transition-transform duration-200 ease-in-out",
        "shadow-[-4px_0_24px_rgba(0,0,0,0.4)] backdrop-blur-lg",
        isOpen ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Trigger.dev run subscriber (renders nothing) */}
      {activeRunId && activeToken && (
        <RunSubscriber
          runId={activeRunId}
          accessToken={activeToken}
          onStatusChange={handleRunStatusChange}
          onMetadataUpdate={handleMetadataUpdate}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-surface-border shrink-0" >
        <Bot className="h-4 w-4 text-[#1DE0E7] shrink-0"/>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-copy-primary leading-none">AI Workspace</p>
          {isGenerating && sharedStatusText ? (
            <span className="flex items-center gap-1 mt-0.5">
              <Loader2 className="h-2.5 w-2.5 animate-spin text-[#1DE0E7] shrink-0" />
              <span className="text-[10px] text-[#1DE0E7] truncate">{sharedStatusText}</span>
            </span>
          ) : (
            <p className="text-[11px] text-copy-muted mt-0.5">Collaborate with Syntropy</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-copy-muted hover:text-copy-primary transition-colors"
          aria-label="Close AI sidebar"
          style={{cursor: "pointer"}}
        >
          <X className="h-4 w-4" style={{cursor: "pointer"}}/>
        </button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="shrink-0 mx-3 mt-3 mb-0 w-[calc(100%-1.5rem)] bg-subtle rounded-md">
          <TabsTrigger
            value="architect"
            className="flex-1 text-xs data-active:bg-[rgba(29,224,231,0.12)] data-active:text-[#1DE0E7] text-copy-muted"
          >
            AI Architect
          </TabsTrigger>
          <TabsTrigger
            value="specs"
            className="flex-1 text-xs data-active:bg-[rgba(29,224,231,0.12)] data-active:text-[#1DE0E7] text-copy-muted"
          >
            Specs
          </TabsTrigger>
        </TabsList>

        {/* AI Architect Tab */}
        <TabsContent value="architect" className="flex flex-col flex-1 min-h-0 mt-0">
          <ScrollArea className="flex-1" ref={scrollRef as React.Ref<HTMLDivElement>}>
            {allMessages.length === 0 ? (
              <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
                <div className="h-10 w-10 rounded-full bg-[rgba(29,224,231,0.12)] flex items-center justify-center">
                  <Bot className="h-5 w-5 text-[#1DE0E7]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-copy-primary">AI Architect</p>
                  <p className="text-xs text-copy-muted mt-1 leading-relaxed">
                    Describe what you want to build and I&apos;ll help design the architecture.
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full">
                  {STARTER_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => sendMessage(chip)}
                      disabled={inputBlocked}
                      className="text-left text-xs px-3 py-2 rounded-full bg-subtle text-[#1DE0E7] border border-surface-border hover:border-[rgba(29,224,231,0.3)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-3 py-4">
                {allMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex flex-col gap-0.5",
                      msg.role === "user" ? "items-end" : "items-start",
                    )}
                  >
                    <span className="text-[10px] text-copy-muted px-1">
                      {msg.sender} · {formatTime(msg.timestamp)}
                    </span>
                    <div
                      className={cn(
                        "max-w-[85%] text-xs px-3 py-2 rounded-xl leading-relaxed",
                        msg.role === "user"
                          ? "bg-[rgba(29,224,231,0.12)] border-2 border-[rgba(29,224,231,0.5)] text-copy-primary"
                          : "bg-elevated border border-surface-border text-copy-secondary",
                      )}
                    >
                      {msg.isLoading ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin text-[#1DE0E7] shrink-0" />
                          {msg.content}
                        </span>
                      ) : (
                        msg.content
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Input area */}
          <div className="shrink-0 px-3 pb-3 pt-2 border-t border-surface-border">
            <div className="flex flex-col gap-2">
              {/* Status strip — shown only when a run is active */}
              {isGenerating && sharedStatusText && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-elevated border border-surface-border">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1DE0E7] animate-pulse shrink-0" />
                  <span className="text-[10px] text-[#1DE0E7] truncate">{sharedStatusText}</span>
                </div>
              )}
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={inputBlocked ? "AI is working…" : "Ask AI Architect…"}
                disabled={inputBlocked}
                className="resize-none text-xs bg-subtle border-surface-border text-copy-primary placeholder:text-copy-muted overflow-y-auto disabled:opacity-50"
                style={{ minHeight: "72px", maxHeight: "160px", height: "72px" }}
              />
              {chatError && (
                <p className="text-[10px] text-red-400 text-right -mt-1">{chatError}</p>
              )}
              <Button
                size="sm"
                className="self-end text-xs h-7 px-3 border-0"
                onClick={() => sendMessage(input)}
                disabled={inputBlocked || !input.trim()}
                style={{
                  background: 'linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)',
                  color: '#ffffff',
                }}
              >
                {inputBlocked ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send"}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Specs Tab */}
        <TabsContent value="specs" className="flex flex-col flex-1 min-h-0 mt-0">
          <SpecsTab
            projectId={projectId}
            roomId={roomId}
            isActive={activeTab === "specs"}
            chatHistory={allMessages.map((m) => ({ role: m.role, content: m.content }))}
          />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
