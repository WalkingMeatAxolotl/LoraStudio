import { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  api,
  type Job,
  type ProjectDetail,
  type TaggerName,
  type TaggerStatus,
  type Version,
} from '../../../api/client'
import JobProgress from '../../../components/JobProgress'
import { useToast } from '../../../components/Toast'
import { useEventStream } from '../../../lib/useEventStream'

interface Ctx {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
}

export default function TaggingPage() {
  const { project, activeVersion, reload } = useOutletContext<Ctx>()
  const { toast } = useToast()

  const [tagger, setTagger] = useState<TaggerName>('wd14')
  const [taggerStatus, setTaggerStatus] = useState<TaggerStatus | null>(null)
  const [outputFormat, setOutputFormat] = useState<'txt' | 'json'>('txt')

  const [job, setJob] = useState<Job | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const jobIdRef = useRef<number | null>(null)
  jobIdRef.current = job?.id ?? null

  useEffect(() => {
    setTaggerStatus(null)
    void api
      .checkTagger(tagger)
      .then(setTaggerStatus)
      .catch((e) =>
        setTaggerStatus({ name: tagger, ok: false, msg: String(e), requires_service: false })
      )
  }, [tagger])

  useEventStream((evt) => {
    const jid = jobIdRef.current
    if (evt.type === 'job_log_appended' && jid && evt.job_id === jid) {
      setLogs((prev) => [...prev, String(evt.text ?? '')])
    } else if (evt.type === 'job_state_changed' && jid && evt.job_id === jid) {
      void api.getJob(jid).then(setJob).catch(() => {})
      if (evt.status === 'done' || evt.status === 'failed') {
        void reload()
      }
    }
  })

  if (!activeVersion) {
    return <p className="text-slate-500">请先选择 / 创建一个版本</p>
  }

  const isLive = job?.status === 'running' || job?.status === 'pending'

  const startTagging = async () => {
    if (!taggerStatus?.ok) {
      toast(`${tagger} 不可用：${taggerStatus?.msg ?? '未知'}`, 'error')
      return
    }
    try {
      const j = await api.startTag(project.id, activeVersion.id, {
        tagger,
        output_format: outputFormat,
      })
      setJob(j)
      setLogs([])
      toast(`已入队 #${j.id}`, 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  return (
    <div className="flex flex-col h-full w-full gap-3">
      <header className="flex items-baseline gap-2 flex-wrap shrink-0">
        <h2 className="text-base font-semibold">③ 打标</h2>
        <span className="text-xs text-slate-500">
          自动给 train/ 下全部图片生成 caption · 完成后到「④ 标签编辑」校对
        </span>
      </header>

      <section className="rounded-lg border border-slate-700 bg-slate-800/40 p-3 flex flex-wrap items-center gap-2 text-xs shrink-0">
        <span className="text-slate-400">tagger</span>
        <select
          value={tagger}
          onChange={(e) => setTagger(e.target.value as TaggerName)}
          className="px-2 py-1 rounded bg-slate-950 border border-slate-700"
        >
          <option value="wd14">WD14（本地 ONNX）</option>
          <option value="joycaption">JoyCaption（远程 vLLM）</option>
        </select>
        <span
          className={
            'px-1.5 py-0.5 rounded text-[10px] font-mono ' +
            (taggerStatus
              ? taggerStatus.ok
                ? 'bg-emerald-700/40 text-emerald-200'
                : 'bg-red-800/40 text-red-200'
              : 'bg-slate-700/60 text-slate-400')
          }
          title={taggerStatus?.msg ?? '检查中...'}
        >
          {taggerStatus
            ? taggerStatus.ok
              ? `✓ ${taggerStatus.msg}`
              : `✗ ${taggerStatus.msg}`
            : '检查中...'}
        </span>

        <span className="text-slate-700">|</span>
        <span className="text-slate-400">format</span>
        <select
          value={outputFormat}
          onChange={(e) => setOutputFormat(e.target.value as 'txt' | 'json')}
          className="px-2 py-1 rounded bg-slate-950 border border-slate-700"
        >
          <option value="txt">.txt</option>
          <option value="json">.json</option>
        </select>

        <span className="flex-1" />
        <button
          onClick={startTagging}
          disabled={isLive || !taggerStatus?.ok}
          className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white disabled:bg-slate-700 disabled:text-slate-500"
        >
          {isLive ? '打标中...' : '开始打标全部'}
        </button>
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
    </div>
  )
}
