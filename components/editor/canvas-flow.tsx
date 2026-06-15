"use client"

import "@xyflow/react/dist/style.css"
import { memo, useCallback, useRef, useState, useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Panel,
  NodeResizer,
  NodeToolbar,
  Handle,
  Position,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  useViewport,
  type ReactFlowInstance,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react"
import { useLiveblocksFlow } from "@liveblocks/react-flow"
import { useUndo, useRedo, useCanUndo, useCanRedo, useUpdateMyPresence, useOthers } from "@liveblocks/react"
import { ZoomIn, ZoomOut, Maximize2, Undo2, Redo2, Loader2 } from "lucide-react"
import { useUser } from "@clerk/nextjs"
import type { CanvasNode, CanvasEdge, CanvasEdgeData, EdgeArrowType } from "@/types/canvas"
import { NODE_COLORS } from "@/types/canvas"
import { ShapePanel, SHAPE_DRAG_TYPE, type ShapeDragPayload } from "./shape-panel"
import { ShapeRenderer } from "./shape-renderer"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useCanvasAutosave, type SaveStatus } from "@/hooks/use-canvas-autosave"
import type { CanvasTemplate } from "./starter-templates"

let nodeCounter = 0

const HANDLE_STYLE: React.CSSProperties = {
  width: 10,
  height: 10,
  background: "rgba(255,255,255,0.5)",
  border: "1.5px solid rgba(255,255,255,0.75)",
  borderRadius: "50%",
}

const CanvasNodeComponent = memo(({ id, data, selected }: NodeProps<CanvasNode>) => {
  const { updateNodeData } = useReactFlow<CanvasNode, CanvasEdge>()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeColor = NODE_COLORS.find((c) => c.bg === data.color) ?? NODE_COLORS[0]

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setEditValue(data.label ?? "")
      setIsEditing(true)
    },
    [data.label],
  )

  const commitEdit = useCallback(() => {
    updateNodeData(id, { label: editValue })
    setIsEditing(false)
  }, [id, editValue, updateNodeData])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === "Escape") {
      setIsEditing(false)
    }
  }, [])

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }
  }, [isEditing])

  return (
    <div className="group relative h-full w-full" onDoubleClick={handleDoubleClick}>
      <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
        <div
          className="nodrag nopan flex items-center gap-1.5 rounded-xl px-2 py-1.5"
          style={{ background: "#18181c", border: "1px solid rgba(255,255,255,0.1)" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {NODE_COLORS.map((color) => {
            const isActive = color.bg === (data.color ?? NODE_COLORS[0].bg)
            return (
              <button
                key={color.bg}
                aria-label={`Set node color ${color.bg}`}
                aria-pressed={isActive}
                className="nodrag nopan relative h-4 w-4 rounded-full transition-transform duration-100 hover:scale-110"
                style={{
                  background: color.bg,
                  outline: isActive ? `2px solid ${color.text}` : "2px solid transparent",
                  outlineOffset: "1.5px",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 0 6px 2px ${color.text}55`
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "none"
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  updateNodeData(id, { color: color.bg, textColor: color.text })
                }}
              />
            )
          })}
        </div>
      </NodeToolbar>
      <NodeResizer
        isVisible={selected}
        minWidth={60}
        minHeight={40}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: "rgba(255,255,255,0.35)",
          border: "1px solid rgba(255,255,255,0.55)",
        }}
        lineStyle={{
          borderColor: "rgba(255,255,255,0.18)",
          borderWidth: 1,
        }}
      />
      <ShapeRenderer shape={data.shape ?? "rectangle"} selected={selected} fillColor={data.color} />
      {!isEditing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-2">
          <span
            className="line-clamp-3 text-center text-sm leading-tight"
            style={{ color: data.textColor ?? activeColor.text }}
          >
            {data.label || (
              <span style={{ color: `${data.textColor ?? activeColor.text}40` }}>Label</span>
            )}
          </span>
        </div>
      )}
      {isEditing && (
        <div className="absolute inset-0 flex items-center justify-center px-2">
          <textarea
            ref={textareaRef}
            value={editValue}
            rows={1}
            placeholder="Label"
            className="nodrag nopan w-full resize-none bg-transparent text-center text-sm outline-none"
            style={{
              color: data.textColor ?? activeColor.text,
              caretColor: data.textColor ?? activeColor.text,
            }}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      <Handle
        type="source"
        position={Position.Top}
        id="t"
        style={HANDLE_STYLE}
        className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        style={HANDLE_STYLE}
        className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        style={HANDLE_STYLE}
        className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="l"
        style={HANDLE_STYLE}
        className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      />
    </div>
  )
})
CanvasNodeComponent.displayName = "CanvasNodeComponent"

const ARROW_OPTIONS: Array<{ type: EdgeArrowType; icon: string }> = [
  { type: "source-to-target", icon: "→" },
  { type: "target-to-source", icon: "←" },
  { type: "bidirectional", icon: "↔" },
]

const CanvasEdgeComponent = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  }: EdgeProps<CanvasEdge>) => {
    const { updateEdgeData } = useReactFlow<CanvasNode, CanvasEdge>()
    const [isHovered, setIsHovered] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState("")
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
      return () => {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current)
        }
      }
    }, [])
    
    const arrowType: EdgeArrowType = data?.arrowType ?? "source-to-target"
    const label = data?.label ?? ""
    const isActive = isHovered || selected

    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    })

    const strokeColor = isActive ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.28)"
    const markerFill = strokeColor
    // Use state-based ID suffix so browser re-fetches marker on color change
    const s = isActive ? "a" : "r"
    const markerEndId = `ae-${id}-${s}`
    const markerStartId = `as-${id}-${s}`

    // Debounced hover so moving between SVG edge and HTML toolbar doesn't flicker
    const handleMouseEnter = useCallback(() => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      setIsHovered(true)
    }, [])

    const handleMouseLeave = useCallback(() => {
      hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 80)
    }, [])

    const handleUpdateArrow = useCallback(
      (type: EdgeArrowType) => updateEdgeData(id, { arrowType: type } as Partial<CanvasEdgeData>),
      [id, updateEdgeData],
    )

    const handleEdgeClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        setEditValue(label)
        setIsEditing(true)
      },
      [label],
    )

    const commitLabel = useCallback(() => {
      updateEdgeData(id, { label: editValue } as Partial<CanvasEdgeData>)
      setIsEditing(false)
    }, [id, editValue, updateEdgeData])

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          commitLabel()
        } else if (e.key === "Escape") {
          setIsEditing(false)
        }
      },
      [commitLabel],
    )

    useEffect(() => {
      if (isEditing) {
        textareaRef.current?.focus()
        const len = textareaRef.current?.value.length ?? 0
        textareaRef.current?.setSelectionRange(len, len)
      }
    }, [isEditing])

    return (
      <>
        <defs>
          {/* End marker: tip at (6,3), placed at path end, oriented with path */}
          <marker id={markerEndId} markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
            <polygon points="0,0 0,6 6,3" fill={markerFill} />
          </marker>
          {/* Start marker: tip at (0,3), pointing back against path direction */}
          <marker id={markerStartId} markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="6,0 6,6 0,3" fill={markerFill} />
          </marker>
        </defs>

        {/* Invisible wide hit area for easier interaction */}
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          onClick={handleEdgeClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: "pointer" }}
        />

        {/* Visible edge line */}
        <path
          d={edgePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.5}
          markerEnd={arrowType !== "target-to-source" ? `url(#${markerEndId})` : undefined}
          markerStart={arrowType !== "source-to-target" ? `url(#${markerStartId})` : undefined}
          style={{ pointerEvents: "none", transition: "stroke 0.15s ease" }}
        />

        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Arrow type toolbar — visible when hovered or selected */}
            {isActive && !isEditing && (
              <div
                className="flex items-center gap-0.5 rounded-lg px-1.5 py-1"
                style={{ background: "#18181c", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {ARROW_OPTIONS.map(({ type, icon }) => (
                  <button
                    key={type}
                    className="rounded px-1.5 py-0.5 text-sm transition-colors"
                    style={{
                      color: arrowType === type ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                      background: arrowType === type ? "rgba(255,255,255,0.1)" : "transparent",
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleUpdateArrow(type)
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            )}

            {/* Label */}
            {isEditing ? (
              <textarea
                ref={textareaRef}
                value={editValue}
                rows={Math.max(1, editValue.split("\n").length)}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag nopan"
                style={{
                  background: "#18181c",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 4,
                  color: "rgba(255,255,255,0.9)",
                  fontSize: "0.75rem",
                  padding: "2px 8px",
                  minWidth: 80,
                  width: Math.max(80, Math.max(...editValue.split("\n").map((l) => l.length)) * 8 + 16),
                  outline: "none",
                  textAlign: "center",
                  resize: "none",
                  lineHeight: "1.4",
                }}
              />
            ) : (
              <div
                onClick={handleEdgeClick}
                style={{
                  color: label ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)",
                  background: label ? "#18181c" : isActive ? "rgba(24,24,28,0.7)" : "transparent",
                  border: `1px solid ${label ? "rgba(255,255,255,0.12)" : isActive ? "rgba(255,255,255,0.07)" : "transparent"}`,
                  fontSize: "0.75rem",
                  padding: label || isActive ? "2px 8px" : "0",
                  borderRadius: 4,
                  cursor: "text",
                  whiteSpace: "pre-wrap",
                  textAlign: "center",
                  transition: "all 0.15s ease",
                }}
              >
                {label || (isActive ? "Add label…" : "")}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      </>
    )
  },
)
CanvasEdgeComponent.displayName = "CanvasEdgeComponent"


function CursorPointer({ color }: { color: string }) {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1 1L1 15L4.5 11.5L7.5 18L9 17.5L6 11L11 11L1 1Z"
        fill={color}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LiveCursors() {
  const others = useOthers()
  const { flowToScreenPosition } = useReactFlow<CanvasNode, CanvasEdge>()
  useViewport() // re-render on pan/zoom so cursor positions stay accurate
  const { user } = useUser()
  const currentUserId = user?.id

  const activeCursors = others.filter((o) => o.id !== currentUserId && o.presence.cursor !== null)

  if (activeCursors.length === 0) return null

  return createPortal(
    <>
      {activeCursors.map((other) => {
        const cursor = other.presence.cursor!
        const { x, y } = flowToScreenPosition(cursor)
        const color = other.info?.cursorColor ?? "#6366f1"
        const name = other.info?.displayName ?? "User"
        const isThinking = other.presence.thinking === true
        return (
          <div
            key={other.connectionId}
            style={{
              position: "fixed",
              left: x,
              top: y,
              pointerEvents: "none",
              zIndex: 9999,
            }}
          >
            <CursorPointer color={color} />
            <div
              style={{
                position: "absolute",
                top: 16,
                left: 4,
                background: color,
                color: "#fff",
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: "0.65rem",
                fontWeight: 600,
                whiteSpace: "nowrap",
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {isThinking && (
                <Loader2
                  style={{ width: 8, height: 8, flexShrink: 0, animation: "spin 1s linear infinite" }}
                />
              )}
              {name}
            </div>
          </div>
        )
      })}
    </>,
    document.body,
  )
}

function ControlButton({
  onClick,
  disabled,
  title,
  ariaLabel,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  ariaLabel: string
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className="flex items-center justify-center rounded-md p-1 transition-colors"
      style={{
        color: disabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.55)",
        cursor: disabled ? "default" : "pointer",
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          ;(e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)"
          ;(e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"
        }
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.color = disabled
          ? "rgba(255,255,255,0.2)"
          : "rgba(255,255,255,0.55)"
        ;(e.currentTarget as HTMLElement).style.background = "transparent"
      }}
    >
      {children}
    </button>
  )
}

function CanvasControls() {
  const instance = useReactFlow<CanvasNode, CanvasEdge>()
  const undo = useUndo()
  const redo = useRedo()
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()

  useKeyboardShortcuts({ instance, undo, redo })

  return (
    <Panel position="bottom-left" style={{ marginBottom: "16px", marginLeft: "12px" }}>
      <div
        className="flex items-center gap-0.5 rounded-full px-2 py-1.5"
        style={{ background: "#18181c", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <ControlButton ariaLabel="Zoom out" onClick={() => instance.zoomOut({ duration: 200 })} title="Zoom out (-)">
          <ZoomOut size={14} />
        </ControlButton>
        <ControlButton ariaLabel="Fit View" onClick={() => instance.fitView({ duration: 300 })} title="Fit view">
          <Maximize2 size={14} />
        </ControlButton>
        <ControlButton ariaLabel="Zoom In" onClick={() => instance.zoomIn({ duration: 200 })} title="Zoom in (+)">
          <ZoomIn size={14} />
        </ControlButton>

        <div
          style={{
            width: 1,
            height: 14,
            background: "rgba(255,255,255,0.12)",
            margin: "0 4px",
            flexShrink: 0,
          }}
        />

        <ControlButton ariaLabel="Undo" onClick={undo} disabled={!canUndo} title="Undo (Cmd+Z)">
          <Undo2 size={14} />
        </ControlButton>
        <ControlButton ariaLabel="Redo" onClick={redo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">
          <Redo2 size={14} />
        </ControlButton>
      </div>
    </Panel>
  )
}

const nodeTypes = { canvasNode: CanvasNodeComponent }
const edgeTypes = { canvasEdge: CanvasEdgeComponent }

interface CanvasFlowProps {
  projectId: string
  pendingTemplate?: CanvasTemplate | null
  onTemplateConsumed?: () => void
  onSaveStatusChange?: (status: SaveStatus) => void
}

export function CanvasFlow({ projectId, pendingTemplate, onTemplateConsumed, onSaveStatusChange }: CanvasFlowProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, onDelete } =
    useLiveblocksFlow<CanvasNode, CanvasEdge>({
      suspense: true,
      nodes: { initial: [] },
      edges: { initial: [] },
    })

  const updateMyPresence = useUpdateMyPresence()
  const instanceRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const loadedRef = useRef(false)

  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])

  // Load saved canvas state only when the Liveblocks room is empty (no active collaboration)
  useEffect(() => {
    if (loadedRef.current) return
    if (nodesRef.current.length > 0 || edgesRef.current.length > 0) {
      loadedRef.current = true
      return
    }
    loadedRef.current = true

    fetch(`/api/projects/${projectId}/canvas`)
      .then((r) => r.json())
      .then((data: { nodes?: CanvasNode[]; edges?: CanvasEdge[] }) => {
        const savedNodes = data.nodes ?? []
        const savedEdges = data.edges ?? []
        if (savedNodes.length === 0 && savedEdges.length === 0) return
        // Re-check room is still empty before loading
        if (nodesRef.current.length > 0 || edgesRef.current.length > 0) return
        onNodesChange(savedNodes.map((n) => ({ type: "add" as const, item: n })))
        onEdgesChange(savedEdges.map((e) => ({ type: "add" as const, item: e })))
        setTimeout(() => instanceRef.current?.fitView({ duration: 400, padding: 0.15 }), 50)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useCanvasAutosave({
    projectId,
    nodes,
    edges,
    onStatusChange: onSaveStatusChange ?? (() => {}),
  })

  useEffect(() => {
    if (!pendingTemplate) return
    const currentNodes = nodesRef.current
    const currentEdges = edgesRef.current

    onNodesChange([
      ...currentNodes.map((n) => ({ type: "remove" as const, id: n.id })),
      ...pendingTemplate.nodes.map((n) => ({ type: "add" as const, item: n })),
    ])
    onEdgesChange([
      ...currentEdges.map((e) => ({ type: "remove" as const, id: e.id })),
      ...pendingTemplate.edges.map((e) => ({ type: "add" as const, item: e })),
    ])

    setTimeout(() => {
      instanceRef.current?.fitView({ duration: 400, padding: 0.15 })
    }, 50)

    onTemplateConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTemplate])

  const onInit = useCallback((instance: ReactFlowInstance<CanvasNode, CanvasEdge>) => {
    instanceRef.current = instance
  }, [])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!instanceRef.current) return
      const pos = instanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      updateMyPresence({ cursor: pos })
    },
    [updateMyPresence],
  )

  const onMouseLeave = useCallback(() => {
    updateMyPresence({ cursor: null })
  }, [updateMyPresence])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData(SHAPE_DRAG_TYPE)
      if (!raw || !instanceRef.current) return

      const { shape, width, height } = JSON.parse(raw) as ShapeDragPayload
      const position = instanceRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      onNodesChange([
        {
          type: "add",
          item: {
            id: `${shape}-${Date.now()}-${++nodeCounter}`,
            type: "canvasNode",
            position: { x: position.x - width / 2, y: position.y - height / 2 },
            data: { label: "", shape },
            width,
            height,
          },
        },
      ])
    },
    [onNodesChange],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDelete={onDelete}
      onInit={onInit}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose}
      defaultEdgeOptions={{ type: "canvasEdge", data: { arrowType: "source-to-target", label: "" } }}
      connectionLineStyle={{ stroke: "rgba(255,255,255,0.4)", strokeWidth: 1.5, strokeDasharray: "5 4" }}
      fitView
      colorMode="dark"
      style={{ background: "#080809" }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="rgba(255,255,255,0.10)"
        bgColor="#080809"
      />
      <CanvasControls />
<Panel position="bottom-center" style={{ marginBottom: "16px" }}>
        <ShapePanel />
      </Panel>
      <LiveCursors />
    </ReactFlow>
  )
}
