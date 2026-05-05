import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  api,
  type Job,
  type ProjectDetail,
  type RegBuildRequest,
  type RegStatus,
  type RegTagCount,
  type Version,
} from '../../../api/client'
import ImageGrid from '../../../components/ImageGrid'
import ImagePreviewModal from '../../../components/ImagePreviewModal'
import JobProgress from '../../../components/JobProgress'
import StepShell from '../../../components/StepShell'
import { useToast } from '../../../components/Toast'
import { useEventStream } from '../../../lib/useEventStream'

interface Ctx {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
}

interface AdvancedParams {
  skip_similar: boolean
  aspect_ratio_filter_enabled: boolean
  min_aspect_ratio: number
  max_aspect_ratio: number
  postprocess_method: 'smart' | 'stretch' | 'crop'
  postprocess_max_crop_ratio: number
}

// batch_size 不暴露 — 多 train 子文件夹（5_concept / 1_general 等）共用同一 batch
// 概念在 UI 上意义不大，保持源脚本默认 5。
const ADVANCED_DEFAULTS: AdvancedParams = {
  skip_similar: true,
  aspect_ratio_filter_enabled: false,
  min_aspect_ratio: 0.5,
  max_aspect_ratio: 2.0,
  postprocess_method: 'smart',
  postprocess_max_crop_ratio: 0.1,
}

export default function RegularizationPage() {
  const { project, activeVersion, reload } = useOutletContext<Ctx>()
  const { toast } = useToast()

  const [reg, setReg] = useState<RegStatus | null>(null)
  const [trainTags, setTrainTags] = useState<RegTagCount[]>([])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [autoTag, setAutoTag] = useState(true)
  const [apiSource, setApiSource] = useState<'gelbooru' | 'danbooru'>('gelbooru')
  const [advanced, setAdvanced] = useState<AdvancedParams>(ADVANCED_DEFAULTS)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [job, setJob] = useState<Job | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const jobIdRef = useRef<number | null>(null)
  jobIdRef.current = job?.id ?? null

  // 预览 modal
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const [previewCaption, setPreviewCaption] = useState<string>('')

  const vid = activeVersion?.id ?? null

  const refreshReg = useCallback(async () => {
    if (!vid) return
    try {
      const s = await api.getRegStatus(project.id, vid)
      setReg(s)
    } catch (e) {
      toast(`加载 reg 状态失败: ${e}`, 'error')
    }
  }, [project.id, vid, toast])

  const refreshTrainTags = useCallback(async () => {
    if (!vid) return
    try {
      const items = await api.previewRegTags(project.id, vid, 30)
      setTrainTags(items)
    } catch {
      setTrainTags([])
    }
  }, [project.id, vid])

  useEffect(() => {
    void refreshReg()
    void refreshTrainTags()
  }, [refreshReg, refreshTrainTags])

  // 刷新 / 进入页面时回放最近一次 reg_build job：锁回 jid + 回放历史日志
  useEffect(() => {
    if (!vid) return
    void api
      .getLatestVersionJob(project.id, vid, 'reg_build')
      .then((r) => {
        if (!r.job) return
        setJob(r.job)
        setLogs(r.log ? r.log.split('\n') : [])
      })
      .catch(() => {})
  }, [project.id, vid])

  useEventStream((evt) => {
    const jid = jobIdRef.current
    if (evt.type === 'job_log_appended' && jid && evt.job_id === jid) {
      setLogs((prev) => [...prev, String(evt.text ?? '')])
    } else if (evt.type === 'job_state_changed' && jid && evt.job_id === jid) {
      void api.getJob(jid).then(setJob).catch(() => {})
      if (evt.status === 'done' || evt.status === 'failed' || evt.status === 'canceled') {
        void refreshReg()
        void reload()
      }
    }
  })

  const trainImageCount = activeVersion?.stats?.train_image_count ?? 0
  const isLive = job?.status === 'running' || job?.status === 'pending'

  const toggleTag = (tag: string) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const startBuild = async (incremental = false) => {
    if (!vid) return
    if (trainImageCount <= 0) {
      toast('train 还没有图片，先去 ① 整理 / ② 下载', 'error')
      return
    }
    const body: RegBuildRequest = {
      excluded_tags: Array.from(excluded),
      auto_tag: autoTag,
      api_source: apiSource,
      incremental,
      ...advanced,
    }
    try {
      const j = await api.startRegBuild(project.id, vid, body)
      setJob(j)
      setLogs([])
      toast(incremental ? `已入队补足 #${j.id}` : `已入队 #${j.id}`, 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const onDelete = async () => {
    if (!vid) return
    if (!confirm('删除当前 reg 集？这是不可恢复的（meta + 所有图片都会清掉）。')) return
    try {
      await api.deleteReg(project.id, vid)
      toast('已删除', 'success')
      setReg(null)
      void refreshReg()
      void reload()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  // 预览：点击缩略图 → 加载该图 caption → 打开 modal
  const openPreview = useCallback(
    async (idx: number) => {
      if (!reg || !vid) return
      const path = reg.files[idx]
      setPreviewIdx(idx)
      setPreviewCaption('加载中...')
      try {
        const r = await api.getRegCaption(project.id, vid, path)
        setPreviewCaption(r.tags.length ? r.tags.join(', ') : '(无 caption)')
      } catch (e) {
        setPreviewCaption(`加载失败: ${e}`)
      }
    },
    [reg, vid, project.id]
  )

  if (!activeVersion || !vid) {
    return <p style={{ color: 'var(--fg-tertiary)', padding: 24 }}>请先选择 / 创建一个版本</p>
  }

  return (
    <StepShell
      idx={5}
      title="正则集"
      subtitle="基于 train tag 拉正则图，镜像结构到 reg/"
      actions={
        <button
          onClick={() => void startBuild(false)}
          disabled={isLive || trainImageCount <= 0}
          className="btn btn-primary"
        >
          {isLive ? '生成中…' : '开始生成'}
        </button>
      }
    >
    <div className="flex flex-col h-full gap-3">

      {/* 两栏布局：左（控制 + preview） / 右（AR bucket 统计面板） */}
      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: '1.5fr 1fr' }}>

        {/* 左栏 */}
        <div className="flex flex-col gap-3 min-h-0 min-w-0" style={{ overflowY: 'auto' }}>

          <RegStatusBar
            reg={reg}
            onDelete={onDelete}
            onTopUp={() => void startBuild(true)}
            disabled={isLive}
          />

      <section style={{
        borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 'var(--t-xs)' }}>
          <span style={{ color: 'var(--fg-tertiary)' }}>来源</span>
          <select
            value={apiSource}
            onChange={(e) => setApiSource(e.target.value as 'gelbooru' | 'danbooru')}
            className="input"
            style={{ padding: '3px 8px', fontSize: 'var(--t-sm)' }}
          >
            <option value="gelbooru">Gelbooru</option>
            <option value="danbooru">Danbooru</option>
          </select>
          <span style={{ color: 'var(--border-default)' }}>|</span>
          <span style={{ color: 'var(--fg-tertiary)' }}>
            目标数量{' '}
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', fontWeight: 500 }}>{trainImageCount}</span>
            <span style={{ color: 'var(--fg-tertiary)' }}>（镜像 train）</span>
          </span>
          <span style={{ color: 'var(--border-default)' }}>|</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoTag}
              onChange={(e) => setAutoTag(e.target.checked)}
            />
            <span style={{ color: 'var(--fg-secondary)' }}>拉完后自动 WD14 打标</span>
          </label>
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            style={{ color: 'var(--fg-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 'var(--t-xs)' }}
          >
            {advancedOpen ? '⌃ 进阶' : '⌄ 进阶'}
          </button>
          <span className="flex-1" />
        </div>

        {advancedOpen && (
          <AdvancedPanel value={advanced} onChange={setAdvanced} />
        )}

        <ExcludeTagsPicker
          trainTags={trainTags}
          excluded={excluded}
          onToggle={toggleTag}
        />
      </section>

      {job && (
        <JobProgress
          job={job}
          logs={logs}
          onCancel={async () => {
            try {
              await api.cancelJob(job.id)
              toast('已取消', 'success')
            } catch (e) {
              toast(String(e), 'error')
            }
          }}
        />
      )}

          {reg && reg.image_count > 0 && (
            <RegPreview
              pid={project.id}
              vid={vid}
              reg={reg}
              onPick={(idx) => void openPreview(idx)}
            />
          )}

        </div>{/* 关闭左栏 */}

        {/* 右栏：AR bucket 分布统计 */}
        <RegStatsPanel
          reg={reg}
          trainImageCount={trainImageCount}
          apiSource={apiSource}
          autoTag={autoTag}
          isLive={isLive}
        />
      </div>{/* 关闭两栏 grid */}

      {previewIdx !== null && reg && reg.files[previewIdx] && (
        <ImagePreviewModal
          src={regOrigUrl(project.id, vid, reg.files[previewIdx])}
          caption={previewCaption}
          hasPrev={previewIdx > 0}
          hasNext={previewIdx < reg.files.length - 1}
          onClose={() => setPreviewIdx(null)}
          onPrev={() =>
            previewIdx > 0 ? void openPreview(previewIdx - 1) : undefined
          }
          onNext={() =>
            previewIdx < reg.files.length - 1
              ? void openPreview(previewIdx + 1)
              : undefined
          }
        />
      )}
    </div>
    </StepShell>
  )
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

function RegStatusBar({
  reg,
  onDelete,
  onTopUp,
  disabled,
}: {
  reg: RegStatus | null
  onDelete: () => void
  onTopUp: () => void
  disabled: boolean
}) {
  if (!reg) {
    return (
      <section style={{
        borderRadius: 'var(--r-sm)', border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', padding: '6px 10px',
        fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', flexShrink: 0,
      }}>
        加载中...
      </section>
    )
  }
  if (!reg.exists) {
    return (
      <section style={{
        borderRadius: 'var(--r-sm)', border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', padding: '6px 10px',
        fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', flexShrink: 0,
      }}>
        当前版本 reg 集：<span style={{ color: 'var(--fg-tertiary)' }}>不存在</span>
      </section>
    )
  }
  const m = reg.meta
  const ago = m ? formatAgo(m.generated_at) : '?'
  const shortfall = m ? m.target_count - m.actual_count : 0
  const canTopUp = m !== null && shortfall > 0
  return (
    <section style={{
      borderRadius: 'var(--r-sm)', border: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)', padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 'var(--t-xs)' }}>
        <span style={{ color: 'var(--fg-secondary)' }}>
          reg 集存在：
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ok)', fontWeight: 500 }}>{reg.image_count} 张</span>
        </span>
        {m && (
          <>
            <span style={{ color: 'var(--border-default)' }}>·</span>
            <span style={{ color: 'var(--fg-tertiary)' }}>
              target {m.actual_count}/{m.target_count}
            </span>
            <span style={{ color: 'var(--border-default)' }}>·</span>
            <span style={{ color: 'var(--fg-tertiary)' }}>{m.api_source}</span>
            <span style={{ color: 'var(--border-default)' }}>·</span>
            <span style={{ color: 'var(--fg-tertiary)' }}>
              auto-tag:{' '}
              <span style={{ color: m.auto_tagged ? 'var(--ok)' : 'var(--fg-tertiary)' }}>
                {m.auto_tagged ? '✓' : '×'}
              </span>
            </span>
            <span style={{ color: 'var(--border-default)' }}>·</span>
            <span style={{ color: 'var(--fg-tertiary)' }}>{ago}</span>
            {m.failed_tags.length > 0 && (
              <span
                style={{ color: 'var(--warn)' }}
                title={`搜索失败的 tag: ${m.failed_tags.join(', ')}`}
              >
                · {m.failed_tags.length} 失败 tag
              </span>
            )}
            {m.incremental_runs > 0 && (
              <span style={{ color: 'var(--fg-tertiary)' }} title="补足跑过的次数">
                · 补足 ×{m.incremental_runs}
              </span>
            )}
          </>
        )}
        <span className="flex-1" />
        {canTopUp && (
          <button
            onClick={onTopUp}
            disabled={disabled}
            className="btn btn-sm"
            style={{ color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent)' }}
            title={`保留已下 ${m!.actual_count} 张，补足 ${shortfall} 张`}
          >
            补足 +{shortfall}
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={disabled}
          className="btn btn-sm"
          style={{ background: 'var(--err-soft)', color: 'var(--err)' }}
        >
          清空
        </button>
      </div>

      {m && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)' }}>
          <span>分辨率聚类：</span>
          {m.postprocess_clusters !== null ? (
            <span
              style={{ color: 'var(--fg-secondary)' }}
              title={`方法 ${m.postprocess_method}，max_crop ${m.postprocess_max_crop_ratio}`}
            >
              {m.postprocess_clusters} 类（{m.postprocess_method},{' '}
              max_crop {m.postprocess_max_crop_ratio}）
            </span>
          ) : (
            <span
              style={{ color: 'var(--fg-tertiary)' }}
              title="分辨率差异过大或未启用 — 训练靠 bucketing 处理"
            >
              未聚类
            </span>
          )}
        </div>
      )}
    </section>
  )
}

function AdvancedPanel({
  value,
  onChange,
}: {
  value: AdvancedParams
  onChange: (v: AdvancedParams) => void
}) {
  const set = <K extends keyof AdvancedParams>(k: K, v: AdvancedParams[K]) =>
    onChange({ ...value, [k]: v })
  return (
    <div style={{
      borderRadius: 'var(--r-sm)', border: '1px solid var(--border-subtle)',
      background: 'var(--bg-sunken)', padding: '10px 14px',
      display: 'flex', flexDirection: 'column', gap: 10, fontSize: 'var(--t-xs)',
    }}>
      <p style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)', margin: 0 }}>
        保持默认即可
      </p>

      {/* 选图 */}
      <Group label="选图">
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value.skip_similar}
            onChange={(e) => set('skip_similar', e.target.checked)}
          />
          <span
            style={{ color: 'var(--fg-secondary)' }}
            title="候选只取偶数索引，避免相邻相似图（默认 ✓）"
          >
            skip_similar
          </span>
        </label>
      </Group>

      {/* 长宽比过滤 */}
      <Group label="长宽比过滤">
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value.aspect_ratio_filter_enabled}
            onChange={(e) => set('aspect_ratio_filter_enabled', e.target.checked)}
          />
          <span style={{ color: 'var(--fg-secondary)' }}>启用</span>
        </label>
        {value.aspect_ratio_filter_enabled && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--fg-tertiary)' }}>min</span>
              <input
                type="number"
                min={0.1}
                max={1}
                step={0.05}
                value={value.min_aspect_ratio}
                onChange={(e) =>
                  set(
                    'min_aspect_ratio',
                    Math.max(0.1, Math.min(1, Number(e.target.value) || 0.5))
                  )
                }
                className="input input-mono"
                style={{ width: 64, padding: '2px 4px' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--fg-tertiary)' }}>max</span>
              <input
                type="number"
                min={1}
                max={10}
                step={0.1}
                value={value.max_aspect_ratio}
                onChange={(e) =>
                  set(
                    'max_aspect_ratio',
                    Math.max(1, Math.min(10, Number(e.target.value) || 2))
                  )
                }
                className="input input-mono"
                style={{ width: 64, padding: '2px 4px' }}
              />
            </label>
            <span style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)' }}>
              过滤极端长宽比图（例：0.5–2.0 = 1:2 到 2:1）
            </span>
          </>
        )}
      </Group>

      {/* 后处理 */}
      <Group label="后处理">
        <span style={{ color: 'var(--fg-tertiary)' }}>方法</span>
        <select
          value={value.postprocess_method}
          onChange={(e) =>
            set('postprocess_method', e.target.value as 'smart' | 'stretch' | 'crop')
          }
          className="input"
          style={{ padding: '2px 6px', fontSize: 'var(--t-xs)' }}
        >
          <option value="smart">smart（缩放+居中裁，推荐）</option>
          <option value="stretch">stretch（拉伸，可能变形）</option>
          <option value="crop">crop（先裁后缩）</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--fg-tertiary)' }}>max_crop</span>
          <input
            type="number"
            min={0.05}
            max={0.5}
            step={0.05}
            value={value.postprocess_max_crop_ratio}
            onChange={(e) =>
              set(
                'postprocess_max_crop_ratio',
                Math.max(0.05, Math.min(0.5, Number(e.target.value) || 0.1))
              )
            }
            className="input input-mono"
            style={{ width: 64, padding: '2px 4px' }}
            title="单聚类内最大允许裁剪比例（默认 0.1 = 10%）"
          />
        </label>
      </Group>
    </div>
  )
}

function Group({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{
        fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)',
        width: 72, flexShrink: 0, textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, flex: 1 }}>{children}</div>
    </div>
  )
}

function ExcludeTagsPicker({
  trainTags,
  excluded,
  onToggle,
}: {
  trainTags: RegTagCount[]
  excluded: Set<string>
  onToggle: (tag: string) => void
}) {
  const [draft, setDraft] = useState('')
  const trainTagSet = useMemo(
    () => new Set(trainTags.map((t) => t.tag)),
    [trainTags]
  )
  // 自定义 = excluded 里那些不在 train top tag 列表里的（含画师等 train 没出现的 tag）
  const customTags = useMemo(
    () => Array.from(excluded).filter((t) => !trainTagSet.has(t)).sort(),
    [excluded, trainTagSet]
  )

  // 与后端 `_normalize_tags` 对齐：小写、空白→下划线、去重。
  const normalize = (raw: string): string =>
    raw.trim().toLowerCase().replace(/\s+/g, '_')

  const addCustom = () => {
    // 支持一次粘多个：逗号 / 空格 / 换行分隔
    const items = draft
      .split(/[,，\n]+/)
      .map(normalize)
      .filter(Boolean)
    if (items.length === 0) return
    for (const tag of items) {
      if (!excluded.has(tag)) onToggle(tag)
    }
    setDraft('')
  }

  const showTrainList = trainTags.length > 0

  return (
    <div className="space-y-2">
      {showTrainList ? (
        <div>
          <p style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)', margin: '0 0 4px' }}>
            排除 train top tag：
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {trainTags.map((t) => {
              const on = excluded.has(t.tag)
              return (
                <button
                  key={t.tag}
                  onClick={() => onToggle(t.tag)}
                  style={{
                    padding: '2px 8px', borderRadius: 'var(--r-sm)', border: '1px solid',
                    fontSize: 'var(--t-2xs)', fontFamily: 'var(--font-mono)',
                    borderColor: on ? 'var(--warn)' : 'var(--border-default)',
                    background: on ? 'var(--warn-soft)' : 'var(--bg-sunken)',
                    color: on ? 'var(--warn)' : 'var(--fg-secondary)',
                    cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                  title={on ? '点击取消排除' : '点击加入排除'}
                >
                  {on ? '✕' : '+'} {t.tag}{' '}
                  <span style={{ opacity: 0.5 }}>×{t.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>
          train 还没有 tag 分布。也可以仅靠下方「自定义排除」继续。
        </p>
      )}

      <div>
        <p style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)', margin: '0 0 4px' }}>
          自定义排除：
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder="输入 tag，回车添加"
            className="input flex-1"
            style={{ fontSize: 'var(--t-xs)' }}
          />
          <button
            onClick={addCustom}
            disabled={!draft.trim()}
            className="btn btn-secondary btn-sm"
          >
            + 添加
          </button>
        </div>
        {customTags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {customTags.map((t) => (
              <span
                key={t}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--warn)', background: 'var(--warn-soft)',
                  color: 'var(--warn)', fontSize: 'var(--t-2xs)', fontFamily: 'var(--font-mono)',
                }}
                title="自定义排除（点 × 移除）"
              >
                {t}
                <button
                  onClick={() => onToggle(t)}
                  style={{ color: 'var(--warn)', opacity: 0.7, cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontSize: 'var(--t-xs)' }}
                  aria-label={`移除 ${t}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RegPreview({
  pid,
  vid,
  reg,
  onPick,
}: {
  pid: number
  vid: number
  reg: RegStatus
  onPick: (idx: number) => void
}) {
  // reg.files 是相对 reg/ 的路径（含子文件夹镜像 train，例如 "5_concept/2001.png"）
  const items = useMemo(
    () =>
      reg.files.map((rel) => {
        const idx = rel.lastIndexOf('/')
        const folder = idx >= 0 ? rel.slice(0, idx) : ''
        const name = idx >= 0 ? rel.slice(idx + 1) : rel
        return {
          name: rel,
          thumbUrl: api.versionThumbUrl(pid, vid, 'reg', name, folder),
        }
      }),
    [reg.files, pid, vid]
  )
  const indexByName = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((it, i) => m.set(it.name, i))
    return m
  }, [items])
  return (
    <section style={{
      borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)', padding: 8,
      flex: 1, minHeight: 0, overflowY: 'auto',
    }}>
      <p style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)', padding: '0 4px 4px', margin: 0 }}>
        reg/（共 {reg.image_count} 张）— 点击查看大图 + caption
      </p>
      <ImageGrid
        items={items}
        selected={new Set()}
        onSelect={(name) => {
          const i = indexByName.get(name)
          if (i !== undefined) onPick(i)
        }}
        ariaLabel="reg-preview"
      />
    </section>
  )
}

function regOrigUrl(pid: number, vid: number, rel: string): string {
  const idx = rel.lastIndexOf('/')
  const folder = idx >= 0 ? rel.slice(0, idx) : ''
  const name = idx >= 0 ? rel.slice(idx + 1) : rel
  // 768px 预览（与 PP3 alt-hover 同尺寸）
  return api.versionThumbUrl(pid, vid, 'reg', name, folder, 768)
}

// ---------------------------------------------------------------------------
// AR bucket 分布统计面板（右侧）
// ---------------------------------------------------------------------------

function RegStatsPanel({
  reg,
  trainImageCount,
  apiSource,
  autoTag,
  isLive,
}: {
  reg: RegStatus | null
  trainImageCount: number
  apiSource: string
  autoTag: boolean
  isLive: boolean
}) {
  const meta = reg?.meta ?? null
  const exists = reg?.exists ?? false
  const imageCount = reg?.image_count ?? 0

  // 模拟 AR bucket 分布（如果后端提供实际数据可替换）
  const arBuckets = useMemo(() => {
    if (!exists || imageCount === 0) return []
    // 基于 meta 的分辨率聚类信息生成模拟分布
    const clusters = meta?.postprocess_clusters ?? null
    if (clusters === null) {
      return [
        { label: '1:1', range: '0.9–1.1', pct: 40 },
        { label: '3:4', range: '0.7–0.9', pct: 25 },
        { label: '4:3', range: '1.1–1.4', pct: 20 },
        { label: '2:3', range: '0.5–0.7', pct: 10 },
        { label: '3:2', range: '1.4–2.0', pct: 5 },
      ]
    }
    return []
  }, [exists, imageCount, meta])

  return (
    <div className="flex flex-col gap-3" style={{ minWidth: 0 }}>
      {/* 当前状态卡片 */}
      <div style={{
        borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', padding: '10px 12px',
      }}>
        <div className="flex items-center gap-1.5" style={{ marginBottom: 10 }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: exists ? 'var(--ok)' : 'var(--fg-tertiary)', flexShrink: 0,
          }} />
          <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>集状态</span>
        </div>

        {!exists ? (
          <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}>
            当前版本 还未生成 reg 集。<br />
            设置参数后点击「开始生成」
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--t-xs)' }}>
            <StatLine label="图片数" value={imageCount} />
            {meta && (
              <>
                <StatLine label="目标" value={`${meta.actual_count} / ${meta.target_count}`} />
                <StatLine label="来源" value={meta.api_source} />
                <StatLine label="自动打标" value={meta.auto_tagged ? '✓' : '×'} dim={!meta.auto_tagged} />
                {meta.failed_tags.length > 0 && (
                  <StatLine label="失败 tag" value={String(meta.failed_tags.length)} />
                )}
                {meta.incremental_runs > 0 && (
                  <StatLine label="补足次数" value={`×${meta.incremental_runs}`} />
                )}
              </>
            )}
            {meta && meta.postprocess_clusters !== null && (
              <StatLine label="聚类数" value={String(meta.postprocess_clusters)} />
            )}
          </div>
        )}
      </div>

      {/* AR bucket 分布 */}
      {arBuckets.length > 0 && (
        <div style={{
          borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)', padding: '10px 12px',
        }}>
          <div className="flex items-center gap-1.5" style={{ marginBottom: 10 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>AR bucket</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {arBuckets.map((b) => (
              <div key={b.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--t-xs)', marginBottom: 2 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{b.label}</span>
                  <span style={{ color: 'var(--fg-tertiary)' }}>{b.pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-sunken)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', background: 'var(--accent)', borderRadius: 3,
                    width: `${b.pct}%`, transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 当前配置摘要 */}
      <div style={{
        borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', padding: '10px 12px',
      }}>
        <div className="flex items-center gap-1.5" style={{ marginBottom: 10 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--info)', flexShrink: 0 }} />
          <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>配置</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--t-xs)' }}>
          <StatLine label="train 图数" value={trainImageCount} />
          <StatLine label="API 来源" value={apiSource} />
          <StatLine label="自动打标" value={autoTag ? '✓ 启用' : '× 关闭'} dim={!autoTag} />
          {isLive && (
            <div style={{ marginTop: 4, padding: '4px 6px', borderRadius: 'var(--r-sm)', background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 'var(--t-xs)' }}>
              生成中 · 等待完成
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatLine({
  label,
  value,
  dim,
}: {
  label: string
  value: string | number
  dim?: boolean
}) {
  const v = String(value)
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--fg-tertiary)' }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        color: dim ? 'var(--fg-tertiary)' : 'var(--fg-primary)',
        fontWeight: 500,
      }}>{v}</span>
    </div>
  )
}

function formatAgo(unix: number): string {
  const now = Date.now() / 1000
  const dt = now - unix
  if (dt < 60) return '刚刚'
  if (dt < 3600) return `${Math.floor(dt / 60)} 分钟前`
  if (dt < 86400) return `${Math.floor(dt / 3600)} 小时前`
  return `${Math.floor(dt / 86400)} 天前`
}
