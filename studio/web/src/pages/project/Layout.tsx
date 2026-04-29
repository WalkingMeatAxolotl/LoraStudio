import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'
import { api, downloadBlob, type ProjectDetail } from '../../api/client'
import ProjectStepper from '../../components/ProjectStepper'
import { useToast } from '../../components/Toast'
import VersionTabs from '../../components/VersionTabs'
import { useEventStream } from '../../lib/useEventStream'

const SIDEBAR_COLLAPSE_KEY = 'studio.projectSidebar.collapsed'

export default function ProjectLayout() {
  const { pid } = useParams()
  const projectId = pid ? Number(pid) : NaN
  const navigate = useNavigate()
  const { toast } = useToast()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const projectRef = useRef<ProjectDetail | null>(null)
  projectRef.current = project

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const reload = useCallback(async () => {
    if (!Number.isFinite(projectId)) return
    try {
      const p = await api.getProject(projectId)
      setProject(p)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  // SSE: 项目 / 版本状态变更 → 重拉
  useEventStream((evt) => {
    if (
      (evt.type === 'project_state_changed' && evt.project_id === projectId) ||
      (evt.type === 'version_state_changed' && evt.project_id === projectId)
    ) {
      void reload()
    }
  })

  const activeVersion = useMemo(() => {
    if (!project) return null
    const aid = project.active_version_id
    return project.versions.find((v) => v.id === aid) ?? project.versions[0] ?? null
  }, [project])

  const handleSelectVersion = async (vid: number) => {
    if (!project) return
    if (project.active_version_id === vid) return
    try {
      const updated = await api.activateVersion(project.id, vid)
      setProject(updated)
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleCreateVersion = async (label: string) => {
    if (!project) return
    try {
      const v = await api.createVersion(project.id, { label })
      await api.activateVersion(project.id, v.id)
      await reload()
      setCreating(false)
      toast(`已创建版本 ${label}`, 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleExportTrain = useCallback(async () => {
    if (!project || !activeVersion || exporting) return
    setExporting(true)
    try {
      const filename = `${project.slug}-${activeVersion.label}.train.zip`
      await downloadBlob(api.versionTrainZipUrl(project.id, activeVersion.id), filename)
    } catch (e) {
      toast(`导出失败: ${e}`, 'error')
    } finally {
      setExporting(false)
    }
  }, [project, activeVersion, exporting, toast])

  const handleDeleteVersion = async (vid: number) => {
    if (!project) return
    const v = project.versions.find((x) => x.id === vid)
    if (!v) return
    if (!confirm(`删除版本 ${v.label}？目录将移到回收站。`)) return
    try {
      await api.deleteVersion(project.id, vid)
      await reload()
      toast(`已删除版本 ${v.label}`, 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  if (error) {
    return (
      <div className="p-4 rounded bg-red-900/40 border border-red-700 text-red-300 font-mono text-sm">
        {error}
      </div>
    )
  }
  if (!project) {
    return <p className="text-slate-500">加载项目...</p>
  }

  return (
    <div className="flex gap-3 h-full relative">
      {/* 抽屉折叠时彻底隐藏 sidebar，只留贴在主区左缘的触发按钮（绝对定位，不占 flow）。
       * 之前用 grid + absolute button + 单一 section 子项，grid 把 section 塞进
       * 第一列的 0px 槽里导致主区不可见，这里改用 flex 兜底。 */}
      {collapsed ? (
        <button
          onClick={toggleSidebar}
          title="展开项目侧栏"
          aria-label="展开项目侧栏"
          className="absolute left-0 top-2 z-10 w-5 h-7 rounded-r bg-slate-800 border border-l-0 border-slate-700 text-slate-300 hover:bg-slate-700 text-xs flex items-center justify-center"
        >
          ›
        </button>
      ) : (
        <aside className="w-[220px] shrink-0 flex flex-col gap-3 border-r border-slate-800 pr-2 overflow-hidden">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="text-xs text-slate-400 hover:text-slate-200 flex-1 truncate"
            >
              ← 返回项目列表
            </Link>
            <button
              onClick={toggleSidebar}
              title="收起侧栏"
              aria-label="收起侧栏"
              className="text-slate-500 hover:text-slate-200 text-sm px-1"
            >
              ‹
            </button>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-100 truncate">
              {project.title}
            </h1>
            <div className="text-[10px] text-slate-500 font-mono truncate">
              {project.slug}
            </div>
          </div>
          <VersionTabs
            versions={project.versions}
            activeId={activeVersion?.id ?? null}
            onSelect={handleSelectVersion}
            onCreate={() => setCreating(true)}
            onDelete={handleDeleteVersion}
          />
          {activeVersion && (
            <button
              onClick={handleExportTrain}
              disabled={exporting}
              title={exporting ? '后端打包中...' : '把当前版本的 train/ 打包下载（含已打标的 caption）'}
              className="text-[11px] px-2 py-1 rounded text-slate-300 hover:text-cyan-300 hover:bg-slate-800/60 disabled:opacity-50 text-left flex items-center gap-1.5"
            >
              <span>{exporting ? '⏳' : '⬇️'}</span>
              <span className="truncate">{exporting ? '打包中...' : '导出训练集'}</span>
            </button>
          )}
          <ProjectStepper project={project} version={activeVersion} />
        </aside>
      )}

      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        <Outlet
          context={{
            project,
            activeVersion,
            reload,
            navigate,
          }}
        />
      </section>

      {creating && (
        <NewVersionDialog
          existingLabels={project.versions.map((v) => v.label)}
          onCancel={() => setCreating(false)}
          onSubmit={handleCreateVersion}
        />
      )}
    </div>
  )
}

function NewVersionDialog({
  existingLabels,
  onCancel,
  onSubmit,
}: {
  existingLabels: string[]
  onCancel: () => void
  onSubmit: (label: string) => void
}) {
  const [label, setLabel] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const l = label.trim()
    if (!l) return setErr('label 不能为空')
    if (!/^[A-Za-z0-9_.-]+$/.test(l))
      return setErr('label 只允许字母 / 数字 / 下划线 / 连字符 / 点')
    if (existingLabels.includes(l)) return setErr('label 已存在')
    onSubmit(l)
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center"
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-[90%] max-w-md space-y-4"
      >
        <h2 className="text-lg font-semibold">新建版本</h2>
        <label className="block">
          <span className="text-xs text-slate-400 font-mono">label</span>
          <input
            autoFocus
            value={label}
            onChange={(e) => {
              setLabel(e.target.value)
              setErr(null)
            }}
            className="mt-1 w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-cyan-500"
            placeholder="例：baseline / high-lr"
          />
        </label>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm bg-slate-700 hover:bg-slate-600"
          >
            取消
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 rounded text-sm bg-cyan-600 hover:bg-cyan-500"
          >
            创建
          </button>
        </div>
      </form>
    </div>
  )
}

// outlet context 类型，子页可以用：
//   const { project, activeVersion } = useOutletContext<ProjectLayoutContext>()
export interface ProjectLayoutContext {
  project: ProjectDetail
  activeVersion: ReturnType<typeof Object.assign> // Version | null
  reload: () => Promise<void>
  navigate: ReturnType<typeof useNavigate>
}
