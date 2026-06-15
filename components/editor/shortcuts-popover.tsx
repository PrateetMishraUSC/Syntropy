"use client"

import { Keyboard } from "lucide-react"
import { Button } from "@/components/ui/button"

const SHORTCUTS = [
  { action: "Zoom In", keys: ["+"] },
  { action: "Zoom Out", keys: ["-"] },
  { action: "Undo", keys: ["⌘", "Z"] },
  { action: "Redo", keys: ["⌘", "⇧", "Z"] },
  { action: "Toggle Sidebar", keys: ["⌥", "A"] },
  { action: "Toggle AI", keys: ["⌥", "S"] },
  { action: "Select Multiple Nodes", keys: ["⇧", "Click"] },
]

export function ShortcutsPopover() {
  return (
    <div className="group relative">
      <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" style={{cursor: "pointer"}}>
        <Keyboard className="h-4 w-4" />
      </Button>

      <div
        className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-60 rounded-xl opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        style={{
          background: "rgba(8,8,9,0.72)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div className="border-b border-white/10 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Keyboard Shortcuts
          </span>
        </div>
        <ul className="p-2">
          {SHORTCUTS.map(({ action, keys }) => (
            <li key={action} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
              <span className="text-xs text-white/55">{action}</span>
              <div className="flex shrink-0 items-center gap-1">
                {keys.map((key, i) => (
                  <kbd
                    key={i}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      background: "rgba(255,255,255,0.07)",
                      border: "1px solid rgba(255,255,255,0.14)",
                      color: "rgba(255,255,255,0.7)",
                    }}
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
