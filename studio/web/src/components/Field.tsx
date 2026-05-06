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

// input 覆盖 .input 默认值（更紧凑；背景用 canvas 而不是 surface）
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '5px 10px',
  background: 'var(--bg-canvas)', border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-sm)', fontSize: 'var(--t-sm)',
  color: 'var(--fg-primary)',
}

const FieldHint = ({ text }: { text: string }) => (
  <span className="ml-2 text-[11px] text-warn align-middle">{text}</span>
)

/** 单个表单字段，按 control kind 分发渲染。 */
export default function Field({
  name, prop, value, onChange, disabled = false, disabledHint,
}: Props) {
  const kind = controlKind(prop)
  const label = fieldLabel(name)
  const help = prop.description
  const hintNode = disabled
    ? <FieldHint text={disabledHint ?? '自动 · 项目控制'} />
    : null
  void name

  // bool ----------------------------------------------------------------
  if (kind === 'bool') {
    return (
      <label className={`flex items-start gap-3 py-1.5 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          style={{ marginTop: 4, height: 16, width: 16, borderRadius: 'var(--r-sm)' }}
        />
        <span className="flex-1">
          <div className="text-sm text-fg-primary">
            {label}
            {hintNode}
          </div>
          {help && <div className="text-xs text-fg-tertiary mt-1">{help}</div>}
        </span>
      </label>
    )
  }

  // select --------------------------------------------------------------
  if (kind === 'select') {
    return (
      <div className="py-1.5">
        <div className="text-sm font-medium text-fg-secondary mb-1">
          {label}{hintNode}
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
        {help && <div className="text-xs text-fg-tertiary mt-1">{help}</div>}
      </div>
    )
  }

  // textarea ------------------------------------------------------------
  if (kind === 'textarea') {
    return (
      <div className="py-1.5">
        <div className="text-sm font-medium text-fg-secondary mb-1">
          {label}{hintNode}
        </div>
        <textarea
          rows={3}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="input input-mono" style={inputStyle}
        />
        {help && <div className="text-xs text-fg-tertiary mt-1">{help}</div>}
      </div>
    )
  }

  // string-list ---------------------------------------------------------
  if (kind === 'string-list') {
    const list = Array.isArray(value) ? (value as string[]) : []
    const text = list.join('\n')
    return (
      <div className="py-1.5">
        <div className="text-sm font-medium text-fg-secondary mb-1">
          {label}（每行一项）{hintNode}
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
        {help && <div className="text-xs text-fg-tertiary mt-1">{help}</div>}
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

function NumberField({
  label, kind, help, value, defaultValue, minimum, maximum,
  onChange, disabled = false, hintNode,
}: NumberFieldProps) {
  const formatNum = (v: unknown) =>
    v === null || v === undefined ? '' : String(v)
  const [raw, setRaw] = useState<string>(() => formatNum(value))
  const inputRef = useRef<HTMLInputElement | null>(null)

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
      setRaw(formatNum(value))
      return
    }
    if (
      (minimum !== undefined && num < minimum) ||
      (maximum !== undefined && num > maximum)
    ) {
      setRaw(formatNum(value))
      return
    }
    onChange(num)
    setRaw(formatNum(num))
  }

  return (
    <div className="py-1.5">
      <div className="text-sm font-medium text-fg-secondary mb-1">
        {label}{hintNode}
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
      {help && <div className="text-xs text-fg-tertiary mt-1">{help}</div>}
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
      <div className="text-sm font-medium text-fg-secondary mb-1">
        {label}
        {kind === 'path' && (
          <span className="ml-2 text-xs text-fg-tertiary">(path)</span>
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
            className="btn btn-secondary btn-sm shrink-0"
          >
            浏览
          </button>
        )}
      </div>
      {help && <div className="text-xs text-fg-tertiary mt-1">{help}</div>}
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
