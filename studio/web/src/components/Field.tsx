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

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--t-sm)', fontWeight: 500, color: 'var(--fg-secondary)', marginBottom: 4,
}
const helpStyle: React.CSSProperties = {
  fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', marginTop: 4,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '5px 10px',
  background: 'var(--bg-canvas)', border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-sm)', fontSize: 'var(--t-sm)',
  color: 'var(--fg-primary)',
}

const renderHint = (text: string) => (
  <span style={{ marginLeft: 8, fontSize: 'var(--t-2xs)', color: 'var(--warn)', verticalAlign: 'middle' }}>
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
          style={{ marginTop: 4, height: 16, width: 16, borderRadius: 'var(--r-sm)' }}
        />
        <span className="flex-1">
          <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-primary)' }}>
            {label}
            {hintNode}
          </div>
          {help && <div style={helpStyle}>{help}</div>}
        </span>
      </label>
    )
  }

  // select --------------------------------------------------------------
  if (kind === 'select') {
    return (
      <div className="py-1.5">
        <div style={labelStyle}>
          {label}
          {hintNode}
        </div>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="input" style={inputStyle}
        >
          {(prop.enum ?? []).map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
        {help && <div style={helpStyle}>{help}</div>}
      </div>
    )
  }

  // textarea ------------------------------------------------------------
  if (kind === 'textarea') {
    return (
      <div className="py-1.5">
        <div style={labelStyle}>
          {label}
          {hintNode}
        </div>
        <textarea
          rows={3}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="input input-mono" style={inputStyle}
        />
        {help && <div style={helpStyle}>{help}</div>}
      </div>
    )
  }

  // string-list ---------------------------------------------------------
  if (kind === 'string-list') {
    const list = Array.isArray(value) ? (value as string[]) : []
    const text = list.join('\n')
    return (
      <div className="py-1.5">
        <div style={labelStyle}>
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
          className="input input-mono" style={inputStyle}
        />
        {help && <div style={helpStyle}>{help}</div>}
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
      <div style={labelStyle}>
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
        className="input input-mono" style={inputStyle}
      />
      {help && <div style={helpStyle}>{help}</div>}
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
      <div style={labelStyle}>
        {label}
        {kind === 'path' && (
          <span style={{ marginLeft: 8, fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}>(path)</span>
        )}
        {hintNode}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={'input' + (kind === 'path' ? ' input-mono' : '')} style={inputStyle}
        />
        {kind === 'path' && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={disabled}
            className="btn btn-secondary btn-sm" style={{ flexShrink: 0, fontSize: 'var(--t-xs)' }}
          >
            浏览
          </button>
        )}
      </div>
      {help && <div style={helpStyle}>{help}</div>}
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
