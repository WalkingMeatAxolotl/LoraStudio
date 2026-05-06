import { createContext, useContext } from 'react'
import type { ProjectDetail, Version } from '../api/client'

export interface ProjectCtxValue {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
  onSelectVersion: (vid: number) => void
  onCreateVersion: () => void
  onExportTrain: () => void
  onDeleteVersion: (vid: number) => void
  exporting: boolean
}

export const ProjectContext = createContext<ProjectCtxValue | null>(null)
export const useProjectCtx = () => useContext(ProjectContext)

// Setter lives at App level so Layout.tsx can push context up to Sidebar
export const ProjectSetterContext = createContext<((v: ProjectCtxValue | null) => void) | null>(null)
export const useProjectCtxSetter = () => useContext(ProjectSetterContext)
