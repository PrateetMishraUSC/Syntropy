"use client"

import { PanelLeftClose, PanelLeftOpen, KeyRound } from "lucide-react"
import { UserButton } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EditorNavbarProps {
  isOpen: boolean
  onToggle: () => void
  title?: string
  actions?: React.ReactNode
  className?: string
}

export function EditorNavbar({ isOpen, onToggle, title, actions, className }: EditorNavbarProps) {
  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-40 h-12 flex items-center",
        "border-b border-white/[0.07] backdrop-blur-md",
        className
      )}
      style={{ background: "rgba(8,8,9,0.55)" }}
    >
      <div className="flex items-center px-2">
        <Button variant="ghost" size="icon" onClick={onToggle} aria-label="Toggle sidebar" style={{cursor: "pointer"}}>
          {isOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
      </div>

      {title && (
        <div className="ml-2 flex flex-col justify-center leading-none truncate max-w-xs">
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
          <span className="text-[10px]" style={{ color: '#56D1E3' }}>workspace</span>
        </div>
      )}

      <div className="flex-1" />

      {actions && <div className="flex items-center gap-1 px-2">{actions}</div>}

      <div className="flex items-center px-3">
      <UserButton appearance={{ variables: { colorPrimary: '#2A729E' } }}>
        <UserButton.MenuItems>
          <UserButton.Link
            label="API Keys"
            labelIcon={<KeyRound className="h-3.5 w-3.5" />}
            href="/settings/api-keys"
          />
        </UserButton.MenuItems>
      </UserButton>
      </div>
    </header>
  )
}
