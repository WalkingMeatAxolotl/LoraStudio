import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type { ProjectLora } from './types'

/** 启动一次拉取所有项目下训练好的 LoRA（output_lora_path 非空）。
 *
 * listProjects → 并行 getProject → 收集 versions[]。N+1 调用：用户场景下
 * project < 20 可接受；启动加载一次，picker 不实时刷新（用户预期）。
 *
 * 失败不抛 —— 用户走「外部文件…」PathPicker 兜底。
 */
export function useProjectLoras(): ProjectLora[] {
  const [items, setItems] = useState<ProjectLora[]>([])
  useEffect(() => {
    void (async () => {
      try {
        const projects = await api.listProjects()
        const details = await Promise.all(
          projects.map((p) => api.getProject(p.id).catch(() => null))
        )
        const out: ProjectLora[] = []
        for (const d of details) {
          if (!d) continue
          for (const v of d.versions) {
            if (!v.output_lora_path) continue
            out.push({
              projectId: d.id,
              projectTitle: d.title,
              versionId: v.id,
              versionLabel: v.label,
              stage: v.stage,
              path: v.output_lora_path,
              createdAt: v.created_at,
            })
          }
        }
        out.sort((a, b) => b.createdAt - a.createdAt)
        setItems(out)
      } catch {
        /* 启动失败不阻塞 */
      }
    })()
  }, [])
  return items
}
