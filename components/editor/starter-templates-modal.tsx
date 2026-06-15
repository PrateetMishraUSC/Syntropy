"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { CanvasNode, CanvasEdge, CanvasShape } from "@/types/canvas"
import type { CanvasTemplate } from "./starter-templates"
import { CANVAS_TEMPLATES } from "./starter-templates"

const PREVIEW_W = 240
const PREVIEW_H = 130
const PREVIEW_PAD = 10

function renderPreviewShape(
  key: string,
  shape: CanvasShape,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
) {
  const stroke = "rgba(255,255,255,0.22)"
  const sw = 0.75

  switch (shape) {
    case "rectangle":
      return <rect key={key} x={x} y={y} width={w} height={h} rx={2} fill={fill} stroke={stroke} strokeWidth={sw} />

    case "pill":
    case "circle":
      return <rect key={key} x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} stroke={stroke} strokeWidth={sw} />

    case "diamond": {
      const pts = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`
      return <polygon key={key} points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />
    }

    case "hexagon": {
      const pts = `${x + w / 2},${y} ${x + w},${y + h / 4} ${x + w},${y + (3 * h) / 4} ${x + w / 2},${y + h} ${x},${y + (3 * h) / 4} ${x},${y + h / 4}`
      return <polygon key={key} points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />
    }

    case "cylinder":
      return (
        <g key={key}>
          <rect x={x} y={y + h * 0.2} width={w} height={h * 0.8} fill={fill} />
          <ellipse cx={x + w / 2} cy={y + h * 0.2} rx={w / 2} ry={h * 0.2} fill={fill} stroke={stroke} strokeWidth={sw} />
          <ellipse cx={x + w / 2} cy={y + h} rx={w / 2} ry={h * 0.2} fill={fill} stroke={stroke} strokeWidth={sw} />
          <line x1={x} y1={y + h * 0.2} x2={x} y2={y + h} stroke={stroke} strokeWidth={sw} />
          <line x1={x + w} y1={y + h * 0.2} x2={x + w} y2={y + h} stroke={stroke} strokeWidth={sw} />
        </g>
      )

    default:
      return <rect key={key} x={x} y={y} width={w} height={h} rx={2} fill={fill} stroke={stroke} strokeWidth={sw} />
  }
}

function TemplatePreview({ nodes, edges }: { nodes: CanvasNode[]; edges: CanvasEdge[] }) {
  if (!nodes.length) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    const w = n.width ?? 120
    const h = n.height ?? 50
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }

  const bw = maxX - minX || 1
  const bh = maxY - minY || 1
  const usableW = PREVIEW_W - PREVIEW_PAD * 2
  const usableH = PREVIEW_H - PREVIEW_PAD * 2
  const scale = Math.min(usableW / bw, usableH / bh)
  const offsetX = PREVIEW_PAD + (usableW - bw * scale) / 2
  const offsetY = PREVIEW_PAD + (usableH - bh * scale) / 2

  const tx = (x: number) => (x - minX) * scale + offsetX
  const ty = (y: number) => (y - minY) * scale + offsetY

  type NodeInfo = { cx: number; cy: number; x: number; y: number; w: number; h: number; data: CanvasNode["data"] }
  const nodeMap = new Map<string, NodeInfo>()
  for (const n of nodes) {
    const w = (n.width ?? 120) * scale
    const h = (n.height ?? 50) * scale
    const x = tx(n.position.x)
    const y = ty(n.position.y)
    nodeMap.set(n.id, { cx: x + w / 2, cy: y + h / 2, x, y, w, h, data: n.data })
  }

  return (
    <svg
      width={PREVIEW_W}
      height={PREVIEW_H}
      style={{ display: "block", borderRadius: 6 }}
      aria-hidden
    >
      <rect width={PREVIEW_W} height={PREVIEW_H} fill="#111114" rx={6} />

      {edges.map((e) => {
        const src = nodeMap.get(e.source)
        const tgt = nodeMap.get(e.target)
        if (!src || !tgt) return null
        return (
          <line
            key={e.id}
            x1={src.cx}
            y1={src.cy}
            x2={tgt.cx}
            y2={tgt.cy}
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={0.85}
          />
        )
      })}

      {nodes.map((n) => {
        const info = nodeMap.get(n.id)
        if (!info) return null
        return renderPreviewShape(
          n.id,
          n.data.shape ?? "rectangle",
          info.x,
          info.y,
          info.w,
          info.h,
          n.data.color ?? "#1F1F1F",
        )
      })}
    </svg>
  )
}

interface StarterTemplatesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (template: CanvasTemplate) => void
}

export function StarterTemplatesModal({ open, onOpenChange, onImport }: StarterTemplatesModalProps) {
  function handleImport(template: CanvasTemplate) {
    onImport(template)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl p-0 gap-0 overflow-hidden"
        style={{ background: "rgba(8,8,9,0.72)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      >
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border">
          <DialogTitle>Starter Templates</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Pick a template to pre-fill the canvas. Your current work will be replaced.
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[520px]">
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
            {CANVAS_TEMPLATES.map((template) => (
              <div
                key={template.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-[rgba(29,224,231,0.3)] hover:bg-accent/30"
              >
                <div className="overflow-hidden rounded-md">
                  <TemplatePreview nodes={template.nodes} edges={template.edges} />
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight text-foreground">{template.name}</p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{template.description}</p>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0 text-xs border-0"
                    onClick={() => handleImport(template)}
                    style={{
                      background: 'linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)',
                      color: '#ffffff',
                      cursor: "pointer"
                    }}
                  >
                    Import
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
