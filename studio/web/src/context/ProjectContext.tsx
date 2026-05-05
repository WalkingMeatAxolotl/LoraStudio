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
