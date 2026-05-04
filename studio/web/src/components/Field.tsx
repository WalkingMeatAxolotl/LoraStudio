import { useEffect, useRef, useState } from 'react'
import type { SchemaProperty } from '../api/client'
import { controlKind, fieldLabel } from '../lib/schema'
import PathPicker from './PathPicker'

interface Props {
  name: string
  prop: SchemaProperty
  value: unknown
  onChange: (v: unknown) => void
  /** disabled 状态（自动控制字段灰显 readonly）。 */
  disabled?: boolean
  /** 自定义 disabled 徽章文字；不传则用默认「自动 · 项目控制」。 */
  disabledHint?: string
}

const labelCls = 'text-sm font-medium text-slate-300 mb-1'
const helpCls = 'text-xs text-slate-500 mt-1'
const inputCls =
  'w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md ' +
  'focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 ' +
  'text-sm disabled:opacity-50 disabled:cursor-not-allowed'

const renderHint = (text: string) => (
  <span className="ml-2 text-[10px] text-amber-400/80 align-middle">
    {text}
  </span>
)

/** 单个表单字段，按 control kind 分发渲染。 */
export default function Field({
  name, prop, value, onChange, disabled = false, disabledHint,
}: Props) {
  const kind = controlKind(prop)
  const label = fieldLabel(name)
  const help = prop.description
  const hintNode = disabled
    ? renderHint(disabledHint ?? '自动 · 项目控制')
    : null
  void name

  // bool ----------------------------------------------------------------
  if (kind === 'bool') {
    return (
      <label
        className={
          'flex items-start gap-3 py-1.5 ' +
          (disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')
        }
      >
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800
            text-cyan-500 focus:ring-cyan-500 disabled:opacity-50"
        />
        <span className="flex-1">
          <div className="text-sm text-slate-200">
            {label}
            {hintNode}
          </div>
          {help && <div className={helpCls}>{help}</div>}
        </span>
      </label>
    )
  }

  // select --------------------------------------------------------------
  if (kind === 'select') {
    return (
      <div className="py-1.5">
        <div className={labelCls}>
          {label}
          {hintNode}
        </div>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={inputCls}
        >
          {(prop.enum ?? []).map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
        {help && <div className={helpCls}>{help}</div>}
      </div>
    )
  }

  // textarea ------------------------------------------------------------
  if (kind === 'textarea') {
    return (
      <div className="py-1.5">
        <div className={labelCls}>
          {label}
          {hintNode}
        </div>
        <textarea
          rows={3}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={inputCls + ' font-mono'}
        />
        {help && <div className={helpCls}>{help}</div>}
      </div>
    )
  }

  // string-list ---------------------------------------------------------
  if (kind === 'string-list') {
    const list = Array.isArray(value) ? (value as string[]) : []
    const text = list.join('\n')
    return (
      <div className="py-1.5">
        <div className={labelCls}>
          {label}（每行一项）
          {hintNode}
        </div>
        <textarea
          rows={Math.max(3, list.length + 1)}
          value={text}
          onChange={(e) => {
            const arr = e.target.value
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
            onChange(arr)
          }}
          disabled={disabled}
          className={inputCls + ' font-mono'}
        />
        {help && <div className={helpCls}>{help}</div>}
      </div>
    )
  }

  // int / float ---------------------------------------------------------
  if (kind === 'int' || kind === 'float') {
    return (
      <NumberField
        label={label}
        kind={kind}
        help={help}
        value={value}
        defaultValue={prop.default}
        minimum={prop.minimum}
        maximum={prop.maximum}
        onChange={onChange}
        disabled={disabled}
        hintNode={hintNode}
      />
    )
  }

  // string / path -------------------------------------------------------
  return (
    <PathStringField
      label={label}
      kind={kind}
      help={help}
      value={value}
      onChange={onChange}
      disabled={disabled}
      hintNode={hintNode}
    />
  )
}

interface NumberFieldProps {
  label: string
  kind: 'int' | 'float'
  help: string | undefined
  value: unknown
  defaultValue: unknown
  minimum?: number
  maximum?: number
  onChange: (v: unknown) => void
  disabled?: boolean
  hintNode?: React.ReactNode
}

/**
 * 数字输入：内部维护 raw 字符串，blur / Enter 时才解析并提交父 onChange。
 *
 * 之前 onChange 立即 parseFloat → 父 setConfig 立即重渲染 → 受控 value 字符串
 * 化把「0.0」截成「0」，用户没法输 0.05。改用 raw 缓冲后输入中状态保留，
 * 仅在 blur 时把合法值上报；外部 value 变化只在 input 不 focus 时同步。
 *
 * min/max：blur 时若解析出的数超出 schema 声明的 minimum/maximum，
 * 回滚到上次合法 value（跟 NaN 同处理）。这是为了恢复 PP10.3 之前
 * `<input type="number" min max>` 自带的 HTML5 校验—— text 模式下浏览器
 * 不再阻止超界输入，要前端自己挡。
 */
function NumberField({
  label, kind, help, value, defaultValue, minimum, maximum,
  onChange, disabled = false, hintNode,
}: NumberFieldProps) {
  const formatNum = (v: unknown) =>
    v === null || v === undefined ? '' : String(v)
  const [raw, setRaw] = useState<string>(() => formatNum(value))
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 外部 value 变化（reset / fork preset）→ 只在用户没在输入时才覆盖 raw，
  // 否则会把用户半截输入吞掉。
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setRaw(formatNum(value))
    }
  }, [value])

  const commit = () => {
    if (raw === '') {
      onChange(defaultValue)
      setRaw(formatNum(defaultValue))
      return
    }
    const num = kind === 'int' ? parseInt(raw, 10) : parseFloat(raw)
    if (Number.isNaN(num)) {
      // 输入非法 → 回滚到上次合法 value
      setRaw(formatNum(value))
      return
    }
    if (
      (minimum !== undefined && num < minimum) ||
      (maximum !== undefined && num > maximum)
    ) {
      // 超出 schema 范围 → 回滚（避免「先存进去再 PUT 时被 400」的滞后反馈）
      setRaw(formatNum(value))
      return
    }
    onChange(num)
    // 规范化显示：用户输 "0.050" / "+1" → 提交后显示 "0.05" / "1"
    setRaw(formatNum(num))
  }

  return (
    <div className="py-1.5">
      <div className={labelCls}>
        {label}
        {hintNode}
      </div>
      <input
        ref={inputRef}
        type="text"
        inputMode={kind === 'int' ? 'numeric' : 'decimal'}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        disabled={disabled}
        className={inputCls}
      />
      {help && <div className={helpCls}>{help}</div>}
    </div>
  )
}

interface PathFieldProps {
  label: string
  kind: 'path' | 'string'
  help: string | undefined
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
  hintNode?: React.ReactNode
}

function PathStringField({
  label, kind, help, value, onChange, disabled = false, hintNode,
}: PathFieldProps) {
  const [picking, setPicking] = useState(false)
  const text = value === null || value === undefined ? '' : String(value)
  return (
    <div className="py-1.5">
      <div className={labelCls}>
        {label}
        {kind === 'path' && (
          <span className="ml-2 text-xs text-slate-500">(path)</span>
        )}
        {hintNode}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={inputCls + (kind === 'path' ? ' font-mono' : '')}
        />
        {kind === 'path' && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={disabled}
            className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            浏览
          </button>
        )}
      </div>
      {help && <div className={helpCls}>{help}</div>}
      {picking && !disabled && (
        <PathPicker
          initialPath={text || undefined}
          onPick={(p) => {
            onChange(p)
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
