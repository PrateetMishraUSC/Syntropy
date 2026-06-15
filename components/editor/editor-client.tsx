"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { EditorNavbar } from "@/components/editor/editor-navbar"
import { ProjectSidebar } from "@/components/editor/project-sidebar"
import { ProjectDialogs } from "@/components/editor/project-dialogs"
import { Button } from "@/components/ui/button"
import { useProjectActions } from "@/hooks/use-project-actions"
import type { ProjectRef } from "@/lib/projects"

interface EditorClientProps {
  ownedProjects: ProjectRef[]
  sharedProjects: ProjectRef[]
}

export function EditorClient({ ownedProjects, sharedProjects }: EditorClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const actions = useProjectActions()

  return (
    <div className="h-screen flex flex-col dot-grid">
      <EditorNavbar isOpen={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      <ProjectSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenCreate={actions.openCreate}
        onRename={actions.openRename}
        onDelete={actions.openDelete}
        ownedProjects={ownedProjects}
        sharedProjects={sharedProjects}
      />
      <main className="flex-1 mt-12 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-4">
          <h1 className="text-3xl font-semibold tracking-tight">
            <span style={{
              background: 'linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>Create a project</span>
            <span style={{ color: '#ffffff' }}> or add an existing one</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-m">
            Start a new architecture workspace, or choose a project from the sidebar
          </p>
          <Button
            onClick={actions.openCreate}
            className="gap-2 mt-1 text-md border-0"
            style={{
              background: 'linear-gradient(135deg, #4394BF 0%, #56D1E3 55%, #1DE0E7 100%)',
              color: '#ffffff',
              boxShadow: '0 0 12px rgba(29, 224, 231, 0.15)',
              cursor: "pointer"
            }}
          >
            <Plus />
            New Project
          </Button>
        </div>
      </main>
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
