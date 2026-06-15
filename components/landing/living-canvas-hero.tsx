"use client"

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
} from "react"
import { SignIn, SignUp } from "@clerk/nextjs"
import Image from "next/image"
import { Sparkles } from "lucide-react"
import { ShapeRenderer } from "@/components/editor/shape-renderer"
import type { CanvasShape } from "@/types/canvas"

// ── Node model ──────────────────────────────────────────────────────────────
// Architecture nodes reuse Syntropy's real palette (bg/text pairs from
// types/canvas.ts) so a node here looks identical to one in the editor.

type Id = "prompt" | "client" | "gateway" | "api" | "auth" | "cache" | "db" | "cdn" | "queue" | "signin"

type ArchNode = {
  id: Exclude<Id, "signin" | "prompt">
  label: string
  shape: CanvasShape
  color: string
  text: string
}

const ARCH: ArchNode[] = [
  { id: "client", label: "Client", shape: "circle", color: "#1F1F1F", text: "#EDEDED" },
  { id: "gateway", label: "Gateway", shape: "diamond", color: "#331B00", text: "#FF990A" },
  { id: "api", label: "API Service", shape: "rectangle", color: "#10233D", text: "#52A8FF" },
  { id: "auth", label: "Auth", shape: "rectangle", color: "#3C1618", text: "#FF6166" },
  { id: "cache", label: "Redis", shape: "cylinder", color: "#062822", text: "#0AC7B4" },
  { id: "db", label: "Postgres", shape: "cylinder", color: "#0F2E18", text: "#62C073" },
]

// Extra nodes rendered only on wide screens (>= 1440px) so big monitors feel
// full without crowding standard / narrow layouts.
const WIDE_ARCH: ArchNode[] = [
  { id: "cdn", label: "CDN", shape: "pill", color: "#062822", text: "#0AC7B4" },
  { id: "queue", label: "Queue", shape: "cylinder", color: "#2E1938", text: "#BF7AF0" },
]

const DIMS: Record<Id, { w: number; h: number }> = {
  prompt: { w: 200, h: 44 },
  client: { w: 64, h: 64 },
  gateway: { w: 76, h: 76 },
  api: { w: 140, h: 46 },
  auth: { w: 118, h: 46 },
  cache: { w: 104, h: 58 },
  db: { w: 104, h: 58 },
  cdn: { w: 110, h: 42 },
  queue: { w: 110, h: 58 },
  signin: { w: 392, h: 300 },
}

// Height of the top navbar; the node board lays out below it.
const NAV = 52

const EDGES: Array<[Id, Id, "n" | "ai" | "link"]> = [
  ["client", "gateway", "n"],
  ["gateway", "api", "n"],
  ["gateway", "auth", "n"],
  ["api", "cache", "n"],
  ["api", "db", "n"],
  ["prompt", "gateway", "ai"],
  ["signin", "client", "link"],
]

// Edges that only exist when the wide-only nodes are present.
const WIDE_EDGES: Array<[Id, Id, "n" | "ai" | "link"]> = [
  ["client", "cdn", "n"],
  ["api", "queue", "n"],
]

const ANIM_DELAY: Record<Id, number> = {
  signin: 0.15,
  client: 0.25,
  gateway: 0.32,
  prompt: 0.32,
  api: 0.39,
  auth: 0.46,
  cache: 0.53,
  db: 0.6,
  cdn: 0.5,
  queue: 0.57,
}

type Pt = { x: number; y: number }
type Positions = Partial<Record<Id, Pt>>

// Adaptive layout: headline anchors top-left, sign-in anchors right, and the
// architecture cluster spreads through the middle band between them.
function layout(w: number, h: number): Positions {
  const signinW = DIMS.signin.w
  const rightMargin = Math.min(160, Math.max(48, w * 0.06))
  const rightX = Math.max(560, w - signinW - rightMargin) // sign-in left edge
  const left = 48
  const cx = (left + 380 + rightX) / 2 // architecture cluster center-x
  const vy = Math.min(120, Math.max(24, (h - 560) / 2)) // gentle vertical centering
  const top = NAV + vy
  return {
    signin: { x: rightX, y: top + 24 },
    client: { x: cx - 32, y: top - 40 },
    gateway: { x: cx - 38, y: top + 118 },
    api: { x: cx - 70, y: top + 386 },
    cache: { x: cx - 52, y: top + 626 },
    db: { x: cx + 212, y: top + 418 },
    auth: { x: cx - 548, y: top + 498 },
    prompt: { x: left + 8, y: top + 288 },
    cdn: { x: cx - 310, y: top + 40 },
    queue: { x: cx + 120, y: top + 250 },
  }
}

function pathD(a: Pt, b: Pt): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dy) >= Math.abs(dx)) {
    const c = Math.max(36, Math.abs(dy) * 0.5)
    return `M${a.x} ${a.y} C ${a.x} ${a.y + (dy > 0 ? c : -c)}, ${b.x} ${b.y - (dy > 0 ? c : -c)}, ${b.x} ${b.y}`
  }
  const c = Math.max(36, Math.abs(dx) * 0.5)
  return `M${a.x} ${a.y} C ${a.x + (dx > 0 ? c : -c)} ${a.y}, ${b.x - (dx > 0 ? c : -c)} ${b.y}, ${b.x} ${b.y}`
}

// ── Clerk appearance ─────────────────────────────────────────────────────────

const CLERK_VARS = { colorPrimary: "#2A729E" } as const

const CLERK_ELEMENTS = {
  rootBox: { width: "100%" },
  headerTitle: { fontSize: "1.2rem", letterSpacing: "-0.01em" },
  socialButtonsBlockButton: {
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.02)",
    transition: "all 0.2s ease",
  },
  formButtonPrimary: {
    background: "linear-gradient(135deg, #37789b 0%, #4aa6c4 55%, #56D1E3 100%)",
    color: "#ffffff",
    border: "none",
    fontWeight: 600,
    transition: "all 0.2s ease",
  },
  formFieldInput: {
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.02)",
  },
  footerActionLink: { color: "#56D1E3" },
  identityPreviewEditButton: { color: "#56D1E3" },
  badge: { color: "#1DE0E7", background: "transparent" },
} as const

// On the canvas the node frame provides the border/background, so the Clerk
// card itself is stripped of its own chrome.
const NODE_APPEARANCE = {
  variables: CLERK_VARS,
  elements: {
    ...CLERK_ELEMENTS,
    cardBox: { width: "100%", boxShadow: "none" },
    card: { background: "transparent", border: "none", boxShadow: "none" },
  },
}

const PLAIN_APPEARANCE = {
  variables: CLERK_VARS,
  elements: {
    ...CLERK_ELEMENTS,
    cardBox: {
      width: "100%",
      boxShadow:
        "0 0 0 1px rgba(255,255,255,0.04), 0 24px 60px -20px rgba(0,0,0,0.7), 0 0 80px -40px rgba(29,224,231,0.25)",
      borderRadius: "1rem",
    },
    card: {
      background: "rgba(20, 21, 26, 0.72)",
      backdropFilter: "blur(20px)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: "1rem",
    },
  },
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <Image src="/syntropy-logo.png" alt="Syntropy" width={26} height={26} priority />
      <span className="text-lg font-semibold tracking-tight">
        <span style={{ color: "#ffffff" }}>Syn</span>
        <span style={{ color: "#1DE0E7" }}>tropy</span>
      </span>
    </div>
  )
}

function GhostCursor({ name, color, style }: { name: string; color: string; style: CSSProperties }) {
  return (
    <div className="pointer-events-none absolute z-30 flex items-center gap-1" style={style}>
      <svg width="14" height="18" viewBox="0 0 16 20" fill="none">
        <path
          d="M1 1L1 15L4.5 11.5L7.5 18L9 17.5L6 11L11 11L1 1Z"
          fill={color}
          stroke="rgba(0,0,0,0.45)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="rounded-md px-1.5 py-0.5"
        style={{ background: color, color: "#fff", fontSize: 11, fontWeight: 600 }}
      >
        {name}
      </span>
    </div>
  )
}

const HANDLE_DOT: CSSProperties = {
  position: "absolute",
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "#080809",
  border: "1.5px solid rgba(29,224,231,0.75)",
  zIndex: 3,
}

// ── Hero ─────────────────────────────────────────────────────────────────────

export function LivingCanvasHero({ mode = "sign-in" }: { mode?: "sign-in" | "sign-up" }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: Id; dx: number; dy: number } | null>(null)

  const [desktop, setDesktop] = useState<boolean | null>(null)
  const [wide, setWide] = useState(false)
  const [pos, setPos] = useState<Positions>({})
  const [dragId, setDragId] = useState<Id | null>(null)
  const [ready, setReady] = useState(false)

  // Breakpoint detection (canvas only makes sense with room + a real pointer)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const on = () => setDesktop(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])

  // Wide screens get extra nodes (CDN, Queue) to fill the canvas.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1440px)")
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])

  // Lay out / re-layout the board centered in the stage
  useEffect(() => {
    if (desktop !== true) return
    const st = stageRef.current
    if (!st) return
    const apply = () => setPos(layout(st.clientWidth, st.clientHeight))
    apply()
    const t = window.setTimeout(() => setReady(true), 60)
    window.addEventListener("resize", apply)
    return () => {
      window.removeEventListener("resize", apply)
      window.clearTimeout(t)
    }
  }, [desktop])

  // Global drag handlers
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      const st = stageRef.current
      if (!d || !st) return
      const dim = DIMS[d.id]
      const w = st.clientWidth
      const h = st.clientHeight
      const x = Math.max(0, Math.min(w - dim.w, e.clientX - d.dx))
      const y = Math.max(0, Math.min(h - dim.h, e.clientY - d.dy))
      setPos((p) => ({ ...p, [d.id]: { x, y } }))
    }
    const up = () => {
      dragRef.current = null
      setDragId(null)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
  }, [])

  const startDrag = useCallback(
    (id: Id) => (e: RPointerEvent) => {
      const p = pos[id]
      if (!p) return
      e.preventDefault()
      dragRef.current = { id, dx: e.clientX - p.x, dy: e.clientY - p.y }
      setDragId(id)
    },
    [pos],
  )

  const centerOf = useCallback(
    (id: Id): Pt | null => {
      const p = pos[id]
      if (!p) return null
      if (id === "signin") return { x: p.x + 8, y: p.y + 130 }
      const d = DIMS[id]
      return { x: p.x + d.w / 2, y: p.y + d.h / 2 }
    },
    [pos],
  )

  // ── Mobile / pre-mount fallback: a plain, centered sign-in ──────────────────
  if (desktop !== true) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-8 px-6 py-12">
        <Wordmark />
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-copy-secondary">
            <span style={{ color: "#1DE0E7" }}>✦</span>
            AI-native architecture
          </div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight">
            <span style={{ color: "#ffffff" }}>Design systems at the </span>
            <span style={{ color: "#1DE0E7" }}>speed of thought.</span>
          </h1>
        </div>
        <div className="w-full max-w-md">
          {mode === "sign-up" ? (
            <SignUp appearance={PLAIN_APPEARANCE} />
          ) : (
            <SignIn appearance={PLAIN_APPEARANCE} />
          )}
        </div>
      </div>
    )
  }

  // ── Desktop living canvas ───────────────────────────────────────────────────
  const hasPos = pos.signin !== undefined
  const archNodes = wide ? [...ARCH, ...WIDE_ARCH] : ARCH
  const edges = wide ? [...EDGES, ...WIDE_EDGES] : EDGES

  return (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        background: "#080809",
        backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* depth vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 120% at 16% -10%, #15161c 0%, transparent 55%)" }}
      />

      {/* top navbar */}
      <div
        className="absolute inset-x-0 top-0 z-40 flex items-center gap-3 px-4"
        style={{
          height: NAV,
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(8,8,9,0.55)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex flex-1 items-center">
          <Wordmark />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white"
              style={{ background: "#3A1726", border: "1.5px solid #F75F8F" }}
            >
              Y
            </span>
            <span
              className="-ml-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white"
              style={{ background: "#2E1938", border: "1.5px solid #BF7AF0" }}
            >
              M
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#62C073" }} />
            3 live
          </span>
        </div>
      </div>

      {/* pinned headline — top-left, below the navbar */}
      <div className="pointer-events-none absolute left-12 z-20" style={{ top: 96, maxWidth: 340 }}>
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-copy-secondary backdrop-blur-sm">
          <span style={{ color: "#1DE0E7" }}>✦</span>
          AI-native architecture
        </div>
        <h1 className="text-[2.6rem] font-bold leading-[1.12] tracking-tight">
          <span style={{ color: "#ffffff" }}>Design systems at the </span>
          <span
            style={{
              background: "linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            speed of thought.
          </span>
        </h1>
        <p className="mt-4 text-xs leading-relaxed text-copy-muted">
          Describe any system in plain English. Syntropy&apos;s AI maps it to a live architecture canvas your whole team can explore, edit, and build on together in real time.
        </p>
      </div>

      {hasPos && (
        <>
          {/* edges */}
          <svg
            className="absolute inset-0 h-full w-full"
            style={{ overflow: "visible", opacity: ready ? 1 : 0, transition: "opacity 0.7s ease" }}
          >
            {edges.map(([s, t, k]) => {
              const a = centerOf(s)
              const b = centerOf(t)
              if (!a || !b) return null
              const stroke =
                k === "ai" ? "#1DE0E7" : k === "link" ? "rgba(29,224,231,0.5)" : "rgba(150,170,190,0.4)"
              return (
                <path
                  key={`${s}-${t}`}
                  d={pathD(a, b)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={k === "n" ? 1.6 : 1.5}
                  strokeDasharray={k === "ai" ? "4 4" : k === "link" ? "5 5" : undefined}
                  className={k === "ai" ? "living-ai" : undefined}
                />
              )
            })}
          </svg>

          {/* architecture nodes */}
          {archNodes.map((n) => {
            const p = pos[n.id]
            if (!p) return null
            const dim = DIMS[n.id]
            return (
              <div
                key={n.id}
                onPointerDown={startDrag(n.id)}
                className="living-node absolute cursor-grab select-none active:cursor-grabbing"
                style={{
                  left: p.x,
                  top: p.y,
                  width: dim.w,
                  height: dim.h,
                  animationDelay: `${ANIM_DELAY[n.id]}s`,
                  zIndex: dragId === n.id ? 40 : 20,
                }}
              >
                <ShapeRenderer shape={n.shape} fillColor={n.color} selected={dragId === n.id} />
                <div
                  className="pointer-events-none absolute inset-0 flex items-center justify-center px-1 text-center leading-tight"
                  style={{ fontSize: n.id === "gateway" ? 11 : 12.5, fontWeight: 500, color: n.text }}
                >
                  {n.label}
                </div>
              </div>
            )
          })}

          {/* prompt node */}
          {pos.prompt && (
            <div
              onPointerDown={startDrag("prompt")}
              className="living-node absolute flex cursor-grab select-none items-center gap-2 rounded-full active:cursor-grabbing"
              style={{
                left: pos.prompt.x,
                top: pos.prompt.y,
                width: DIMS.prompt.w,
                height: DIMS.prompt.h,
                paddingLeft: 14,
                background: "rgba(29,224,231,0.08)",
                border: "1px solid rgba(29,224,231,0.5)",
                color: "#1DE0E7",
                animationDelay: `${ANIM_DELAY.prompt}s`,
                zIndex: dragId === "prompt" ? 40 : 20,
              }}
            >
              <Sparkles size={14} />
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>Describe a system…</span>
            </div>
          )}

          {/* ghost collaborators */}
          {pos.gateway && (
            <GhostCursor
              name="You"
              color="#F75F8F"
              style={{
                left: pos.gateway.x + 96,
                top: pos.gateway.y + 6,
                animation: "living-float-a 7s ease-in-out infinite",
              }}
            />
          )}
          {pos.auth && (
            <GhostCursor
              name="Me"
              color="#BF7AF0"
              style={{
                left: pos.auth.x - 8,
                top: pos.auth.y - 28,
                animation: "living-float-b 9s ease-in-out infinite",
              }}
            />
          )}

          {/* sign-in node — draggable only by its handle bar */}
          {pos.signin && (
            <div
              className="living-node absolute select-none"
              style={{
                left: pos.signin.x,
                top: pos.signin.y,
                width: DIMS.signin.w,
                animationDelay: `${ANIM_DELAY.signin}s`,
                zIndex: dragId === "signin" ? 50 : 30,
              }}
            >
              <div
                className="relative rounded-2xl"
                style={{
                  border: "1px solid rgba(29,224,231,0.45)",
                  boxShadow:
                    "0 0 0 1.5px rgba(29,224,231,0.18), 0 24px 60px -20px rgba(0,0,0,0.7)",
                  background: "rgba(12,12,16,0.55)",
                  backdropFilter: "blur(10px)",
                }}
              >
                <span style={{ ...HANDLE_DOT, left: -4, top: 64 }} />
                <span style={{ ...HANDLE_DOT, left: -4, bottom: 64 }} />
                <span style={{ ...HANDLE_DOT, left: "50%", top: -4, transform: "translateX(-50%)" }} />

                <div
                  onPointerDown={startDrag("signin")}
                  className="flex cursor-grab items-center gap-2 border-b px-3 py-2 active:cursor-grabbing"
                  style={{ borderColor: "rgba(255,255,255,0.06)" }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#1DE0E7" }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-geist-mono)" }}>
                    {mode}.node
                  </span>
                  <span className="ml-auto" style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                    drag me
                  </span>
                </div>

                <div className="p-2">
                  {mode === "sign-up" ? (
                    <SignUp appearance={NODE_APPEARANCE} />
                  ) : (
                    <SignIn appearance={NODE_APPEARANCE} />
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* hint */}
      <div
        className="pointer-events-none absolute bottom-6 left-12 z-20 text-xs"
        style={{ color: "rgba(255,255,255,0.42)" }}
      >
        Drag any node - It&apos;s a real canvas!
      </div>
    </div>
  )
}
