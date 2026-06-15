"use client"

import { useState, useEffect, useCallback } from "react"
import { Link2, Trash2, UserPlus, Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Person = {
  email: string
  name: string | null
  imageUrl: string | null
}

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
  projectName: string
}

export function ShareDialog({ open, onOpenChange, roomId, projectName }: ShareDialogProps) {
  const [isOwner, setIsOwner] = useState(false)
  const [owner, setOwner] = useState<Person | null>(null)
  const [collaborators, setCollaborators] = useState<Person[]>([])
  const [loading, setLoading] = useState(false)
  const [emailInput, setEmailInput] = useState("")
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchCollaborators = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${roomId}/collaborators`)
      if (res.ok) {
        const data = await res.json()
        setIsOwner(data.isOwner)
        setOwner(data.owner)
        setCollaborators(data.collaborators)
      }
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    if (open) {
      setEmailInput("")
      setInviteError(null)
      fetchCollaborators()
    }
  }, [open, fetchCollaborators])

  async function invite() {
    const email = emailInput.trim().toLowerCase()
    if (!email) return
    setInviting(true)
    setInviteError(null)
    try {
      const res = await fetch(`/api/projects/${roomId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setInviteError((data as { error?: string }).error ?? "Failed to invite")
        return
      }
      setEmailInput("")
      await fetchCollaborators()
    } finally {
      setInviting(false)
    }
  }

  async function remove(email: string) {
    setRemovingEmail(email)
    try {
      await fetch(
        `/api/projects/${roomId}/collaborators/${encodeURIComponent(email)}`,
        { method: "DELETE" }
      )
      setCollaborators((prev) => prev.filter((c) => c.email !== email))
    } finally {
      setRemovingEmail(null)
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/editor/${roomId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        style={{ background: "rgba(8,8,9,0.72)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      >
        <DialogHeader>
          <DialogTitle>Share &ldquo;{projectName}&rdquo;</DialogTitle>
        </DialogHeader>

        {/* Invite row — owner only */}
        {isOwner && (
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="Invite by email"
              value={emailInput}
              onChange={(e) => {
                setEmailInput(e.target.value)
                setInviteError(null)
              }}
              onKeyDown={(e) => { if (e.key === "Enter") invite() }}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={invite}
              disabled={inviting || !emailInput.trim()}
              className="gap-1.5 shrink-0 border-0"
              style={{
                background: 'linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)',
                color: '#ffffff',
                cursor: "pointer"
              }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Invite
            </Button>
          </div>
        )}
        {inviteError && (
          <p className="text-xs text-destructive -mt-2">{inviteError}</p>
        )}

        {/* People with access */}
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            People with access
          </p>

          {loading ? (
            <p className="text-sm text-muted-foreground py-2">Loading…</p>
          ) : (
            <>
              {/* Owner row */}
              {owner && (
                <PersonRow
                  person={owner}
                  role="Owner"
                />
              )}

              {/* Collaborator rows */}
              {collaborators.map((c) => (
                <PersonRow
                  key={c.email}
                  person={c}
                  role="Collaborator"
                  onRemove={isOwner ? () => remove(c.email) : undefined}
                  removing={removingEmail === c.email}
                />
              ))}

              {collaborators.length === 0 && isOwner && (
                <p className="text-sm text-muted-foreground py-1 pl-2">
                  No collaborators yet.
                </p>
              )}
            </>
          )}
        </div>

        {/* Copy link */}
        <div className="-mx-4 -mb-4 flex items-center justify-between rounded-b-xl border-t border-border bg-muted/50 px-4 py-3">
          <span className="text-xs text-muted-foreground">Share via link</span>
          <Button
          variant="outline"
          size="sm"
          onClick={copyLink}
          className="gap-1.5 shrink-0"
          style={{ borderColor: 'rgba(29,224,231,0.3)', color: '#56D1E3', cursor: "pointer" }}
        >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" style={{ color: '#1DE0E7' }} />
                Copied!
              </>
            ) : (
              <>
                <Link2 className="h-3.5 w-3.5" style={{cursor: "pointer"}}/>
                Copy link
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PersonRow({
  person,
  role,
  onRemove,
  removing,
}: {
  person: Person
  role: "Owner" | "Collaborator"
  onRemove?: () => void
  removing?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
      <Avatar name={person.name} email={person.email} imageUrl={person.imageUrl} />
      <div className="flex-1 min-w-0">
        {person.name ? (
          <>
            <p className="text-sm font-medium truncate">{person.name}</p>
            <p className="text-xs text-muted-foreground truncate">{person.email}</p>
          </>
        ) : (
          <p className="text-sm truncate">{person.email}</p>
        )}
      </div>
      <span className="text-xs shrink-0" >{role}</span>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          disabled={removing}
          aria-label={`Remove ${person.email}`}
          className="text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

function Avatar({
  name,
  email,
  imageUrl,
}: {
  name: string | null
  email: string
  imageUrl: string | null
}) {
  const initials = name
    ? name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : email[0].toUpperCase()

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name ?? email}
        className="h-8 w-8 rounded-full object-cover shrink-0"
      />
    )
  }

  return (
    <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(29,224,231,0.12)' }}>
      <span className="text-xs font-medium" style={{ color: '#1DE0E7' }}>{initials}</span>
    </div>
  )
}
