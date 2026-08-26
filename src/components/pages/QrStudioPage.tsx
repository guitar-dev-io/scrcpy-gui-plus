import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  FileCode2,
  Info,
  Layers3,
  Link2,
  AlertTriangle,
  Loader2,
  MoreHorizontal,
  Palette,
  Pencil,
  QrCode,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react'
import { generateQrSvg } from '../../services/deepLinkService'
import {
  loadQrRecords,
  parseMultiQrInput,
  qrFileName,
  saveQrRecords,
  styleQrSvg,
} from '../../services/qrStudioService'
import {
  DEFAULT_QR_STYLE,
  type QrContentType,
  type QrRecord,
  type QrStyle,
} from '../../types/qrStudio'

type CreateMode = 'single' | 'multi'
type LibraryFilter = 'all' | QrContentType

interface QrStudioPageProps {
  onExit?: () => void
}

const accent = '#ff4f57'
const panelClass =
  'rounded-xl border border-[#263244] bg-[linear-gradient(145deg,rgba(20,31,45,.98),rgba(13,22,34,.98))] shadow-[0_20px_60px_rgba(0,0,0,.2)]'
const inputClass =
  'w-full rounded-lg border border-[#2a374a] bg-[#0c1624] px-3 py-2.5 text-[11px] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[#ff4f57]/70 focus:ring-2 focus:ring-[#ff4f57]/10'

const typeOptions: Array<{ value: QrContentType; label: string }> = [
  { value: 'url', label: 'URL' },
  { value: 'text', label: 'Text' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'contact', label: 'Contact' },
  { value: 'deep-link', label: 'Deep Link' },
]

function nowIso(): string {
  return new Date().toISOString()
}

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function downloadSvg(record: QrRecord): void {
  const svg = styleQrSvg(record.svg, record.style)
  downloadBlob(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    qrFileName(record.name, 'svg'),
  )
}

async function downloadPng(record: QrRecord): Promise<void> {
  const svg = styleQrSvg(record.svg, record.style)
  const svgUrl = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
  )
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Unable to render QR image'))
      image.src = svgUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = record.style.size
    canvas.height = record.style.size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.fillStyle = record.style.background
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error('Unable to export PNG')
    downloadBlob(blob, qrFileName(record.name, 'png'))
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

function relativeDate(value: string): string {
  const delta = Math.max(0, Date.now() - new Date(value).getTime())
  const hours = Math.floor(delta / 3_600_000)
  if (hours < 1) return 'Updated just now'
  if (hours < 24) return `Updated ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `Updated ${days}d ago`
}

function typeBadgeClass(type: QrContentType): string {
  if (type === 'wifi') return 'bg-sky-500/10 text-sky-400'
  if (type === 'text' || type === 'contact') return 'bg-emerald-500/10 text-emerald-400'
  if (type === 'deep-link') return 'bg-violet-500/10 text-violet-400'
  return 'bg-[#ff4f57]/10 text-[#ff6269]'
}

function colorContrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const normalized = hex.replace('#', '')
    const channels = [0, 2, 4].map((offset) =>
      Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
    )
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    )
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export default function QrStudioPage({ onExit }: QrStudioPageProps) {
  const [records, setRecords] = useState<QrRecord[]>(() =>
    loadQrRecords(window.localStorage),
  )
  const [mode, setMode] = useState<CreateMode>('single')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('https://example.com')
  const [contentType, setContentType] = useState<QrContentType>('url')
  const [multiInput, setMultiInput] = useState('')
  const [style, setStyle] = useState<QrStyle>(DEFAULT_QR_STYLE)
  const [previewSvg, setPreviewSvg] = useState('')
  const [previewError, setPreviewError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [pageLimit, setPageLimit] = useState(12)
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const pageRef = useRef<HTMLDivElement>(null)
  const previewRequest = useRef(0)
  const foregroundRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    saveQrRecords(window.localStorage, records)
  }, [records])

  useEffect(() => {
    if (mode !== 'single' || !content.trim()) {
      setPreviewSvg('')
      setGenerating(false)
      return
    }
    const requestId = ++previewRequest.current
    setGenerating(true)
    setPreviewError(false)
    const timer = window.setTimeout(() => {
      generateQrSvg(content.trim(), style.errorCorrection)
        .then((svg) => {
          if (previewRequest.current === requestId) setPreviewSvg(svg)
        })
        .catch(() => {
          if (previewRequest.current === requestId) {
            setPreviewSvg('')
            setPreviewError(true)
          }
        })
        .finally(() => {
          if (previewRequest.current === requestId) setGenerating(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [content, mode, style.errorCorrection])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase()
    return records.filter((record) => {
      const matchesType = filter === 'all' || record.contentType === filter
      const matchesQuery =
        !query ||
        `${record.name} ${record.content} ${record.contentType}`
          .toLowerCase()
          .includes(query)
      return matchesType && matchesQuery
    })
  }, [filter, records, search])

  const multiEntries = useMemo(() => parseMultiQrInput(multiInput), [multiInput])
  const visibleRecords = filteredRecords.slice(0, pageLimit)
  const styledPreview = previewSvg
    ? styleQrSvg(previewSvg, { ...style, size: 420 })
    : ''
  const linkCount = records.filter(
    (record) => record.contentType === 'url' || record.contentType === 'deep-link',
  ).length
  const contrastRatio = colorContrast(style.foreground, style.background)
  const hasScanFriendlyContrast = contrastRatio >= 4.5

  useEffect(() => {
    if (!actionMenuId) return
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionMenuId(null)
    }
    window.addEventListener('keydown', closeMenu)
    return () => window.removeEventListener('keydown', closeMenu)
  }, [actionMenuId])

  const currentPreviewRecord: QrRecord | null = previewSvg
    ? {
        id: editingId || 'preview',
        name: name.trim() || 'qr-code',
        content: content.trim(),
        contentType,
        svg: previewSvg,
        style,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
    : null

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setContent('https://example.com')
    setContentType('url')
    setMultiInput('')
    setStyle(DEFAULT_QR_STYLE)
  }

  const cancelEdit = () => {
    resetForm()
    setActionMenuId(null)
    setNotice('Editing cancelled')
  }

  const saveSingle = async () => {
    const trimmedContent = content.trim()
    if (!trimmedContent) return
    setSaving(true)
    try {
      const svg = await generateQrSvg(trimmedContent, style.errorCorrection)
      const timestamp = nowIso()
      if (editingId) {
        setRecords((current) =>
          current.map((record) =>
            record.id === editingId
              ? {
                  ...record,
                  name: name.trim() || 'Untitled QR Code',
                  content: trimmedContent,
                  contentType,
                  style,
                  svg,
                  updatedAt: timestamp,
                }
              : record,
          ),
        )
        setNotice('QR code updated')
      } else {
        setRecords((current) => [
          {
            id: createId(),
            name: name.trim() || 'Untitled QR Code',
            content: trimmedContent,
            contentType,
            style,
            svg,
            createdAt: timestamp,
            updatedAt: timestamp,
            favorite: false,
          },
          ...current,
        ])
        setNotice('QR code created')
      }
      resetForm()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to generate QR code')
    } finally {
      setSaving(false)
    }
  }

  const saveMulti = async () => {
    if (multiEntries.length === 0) return
    setSaving(true)
    try {
      const timestamp = nowIso()
      const created = await Promise.all(
        multiEntries.map(async (entry) => ({
          id: createId(),
          name: entry.name,
          content: entry.content,
          contentType,
          style,
          svg: await generateQrSvg(entry.content, style.errorCorrection),
          createdAt: timestamp,
          updatedAt: timestamp,
          favorite: false,
        })),
      )
      setRecords((current) => [...created, ...current])
      setNotice(`${created.length} QR codes created`)
      resetForm()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to generate QR codes')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (record: QrRecord) => {
    setActionMenuId(null)
    setMode('single')
    setEditingId(record.id)
    setName(record.name)
    setContent(record.content)
    setContentType(record.contentType)
    setStyle(record.style)
    if (typeof pageRef.current?.scrollTo === 'function') {
      pageRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const duplicate = (record: QrRecord) => {
    const timestamp = nowIso()
    setRecords((current) => [
      {
        ...record,
        id: createId(),
        name: `${record.name} copy`,
        createdAt: timestamp,
        updatedAt: timestamp,
        favorite: false,
      },
      ...current,
    ])
    setActionMenuId(null)
    setNotice('QR code duplicated')
  }

  const remove = (record: QrRecord) => {
    if (!window.confirm(`Delete “${record.name}”?`)) return
    setRecords((current) => current.filter((item) => item.id !== record.id))
    setActionMenuId(null)
    if (editingId === record.id) resetForm()
    setNotice('QR code deleted')
  }

  const toggleFavorite = (id: string) => {
    setRecords((current) =>
      current.map((record) =>
        record.id === id ? { ...record, favorite: !record.favorite } : record,
      ),
    )
  }

  const copyContent = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice('Content copied')
    } catch {
      setNotice('Clipboard permission was denied')
    }
  }

  const runTest = () => {
    const value = content.trim()
    if (/^https?:\/\//i.test(value)) {
      window.open(value, '_blank', 'noopener,noreferrer')
      setNotice('Opened link in browser')
      return
    }
    setNotice('QR content is valid and ready to scan')
  }

  const exportPng = (record: QrRecord) => {
    void downloadPng(record)
      .then(() => setNotice('PNG downloaded'))
      .catch(() => setNotice('PNG export failed'))
  }

  return (
    <div ref={pageRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_58%_20%,rgba(255,79,87,.07),transparent_25%)] px-4 pb-8 text-slate-100 lg:px-6">
      <header className="flex min-h-[78px] flex-wrap items-center justify-between gap-4 border-b border-[#202c3c] py-4">
        <div className="flex items-center gap-3">
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              aria-label="Back to Dashboard"
              title="Back to Dashboard"
              className="group flex h-10 items-center gap-2 rounded-xl border border-[#ff6068]/35 bg-[#ff4f57]/10 px-3 text-[9px] font-semibold text-[#ff747a] transition hover:bg-[#ff4f57]/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/45"
            >
              <ArrowLeft size={15} /> Dashboard
            </button>
          )}
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#ff656b,#ff3f49)] text-white shadow-[0_8px_25px_rgba(255,69,78,.3)]" aria-hidden="true">
            <QrCode size={21} />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">QR Studio</h1>
            <p className="mt-0.5 text-[10px] text-slate-400">
              Create, style, organize, and export reusable QR codes.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="flex h-10 items-center gap-2 rounded-xl border border-[#2a3545] bg-[#111c2a] px-3 text-slate-300">
            <Bookmark size={13} />
            <b className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-white">{records.length}</b>
            Saved
          </span>
          <span className="flex h-10 items-center gap-2 rounded-xl border border-[#ff4f57]/35 bg-[#ff4f57]/[.07] px-3 text-[#ff6970]">
            <Link2 size={13} />
            <b className="rounded-full bg-[#ff4f57]/15 px-1.5 py-0.5">{linkCount}</b>
            Links
          </span>
        </div>
      </header>

      <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(430px,.95fr)_minmax(430px,1.05fr)]" aria-label="QR code creator">
        <div className={`${panelClass} p-4`}>
          <h2 className="mb-3 text-[14px] font-semibold text-white">Create QR Code</h2>
          <div className="grid grid-cols-2 rounded-xl border border-[#2a3749] bg-[#0d1725] p-1">
            <button
              type="button"
              onClick={() => setMode('single')}
              aria-pressed={mode === 'single'}
              className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[10px] font-semibold transition ${mode === 'single' ? 'bg-[linear-gradient(135deg,#ff605f,#fa414d)] text-white shadow-[0_6px_18px_rgba(255,70,77,.25)]' : 'text-slate-400 hover:text-white'}`}
            >
              <UserRound size={13} /> Single
            </button>
            <button
              type="button"
              aria-label="Multi create"
              aria-pressed={mode === 'multi'}
              disabled={Boolean(editingId)}
              onClick={() => setMode('multi')}
              className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[10px] font-semibold transition disabled:opacity-35 ${mode === 'multi' ? 'bg-[linear-gradient(135deg,#ff605f,#fa414d)] text-white shadow-[0_6px_18px_rgba(255,70,77,.25)]' : 'text-slate-400 hover:text-white'}`}
            >
              <Layers3 size={13} /> Bulk
            </button>
          </div>

          <div className="mt-4 space-y-3.5">
            {editingId && (
              <div className="flex items-center justify-between rounded-lg border border-[#ff4f57]/30 bg-[#ff4f57]/10 px-3 py-2 text-[9px] text-[#ff747a]">
                <span className="flex items-center gap-2"><Pencil size={11} /> Editing saved QR code</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    cancelEdit()
                  }}
                  className="flex h-7 items-center gap-1.5 rounded-md border border-[#ff4f57]/25 bg-[#ff4f57]/10 px-2 text-[8px] font-medium hover:bg-[#ff4f57]/20"
                  aria-label="Cancel editing"
                >
                  Cancel <X size={11} />
                </button>
              </div>
            )}

            {mode === 'single' ? (
              <>
                <label className="block text-[9px] font-medium text-slate-300">
                  Name
                  <input value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} mt-1.5`} placeholder="e.g. Product landing page" />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(130px,.62fr)_minmax(200px,1.38fr)]">
                  <label className="block text-[9px] font-medium text-slate-300">
                    Type
                    <select value={contentType} onChange={(event) => setContentType(event.target.value as QrContentType)} className={`${inputClass} mt-1.5`}>
                      {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-[9px] font-medium text-slate-300">
                    Content
                    <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={2} className={`${inputClass} mt-1.5 resize-none font-mono leading-relaxed`} placeholder={contentType === 'url' ? 'https://example.com' : contentType === 'wifi' ? 'WIFI:T:WPA;S:Network;P:Password;;' : 'Text to encode'} />
                  </label>
                </div>
              </>
            ) : (
              <label className="block text-[9px] font-medium text-slate-300">
                One QR code per line
                <textarea value={multiInput} onChange={(event) => setMultiInput(event.target.value)} rows={5} className={`${inputClass} mt-1.5 resize-none font-mono leading-relaxed`} placeholder={'Website | https://example.com\nSupport | mailto:help@example.com'} />
                <span className="mt-1.5 flex justify-between text-[8px] text-slate-500"><span>Use “Name | content” or content only.</span><b className="text-[#ff656c]">{multiEntries.length} ready</b></span>
              </label>
            )}

            <div id="qr-design-controls" className="rounded-xl border border-[#2a3749] bg-[#0d1725]/75 p-3">
              <p className="flex items-center gap-2 text-[9px] font-semibold text-slate-200"><Palette size={13} color={accent} /> Design</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="text-[8px] text-slate-400">Foreground
                  <span className="mt-1.5 flex h-9 items-center gap-2 rounded-lg border border-[#2a3749] bg-[#0a1421] px-2">
                    <input ref={foregroundRef} type="color" value={style.foreground} onChange={(event) => setStyle((current) => ({ ...current, foreground: event.target.value }))} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" />
                    <span className="truncate font-mono text-[8px] text-slate-300">{style.foreground}</span>
                  </span>
                </label>
                <label className="text-[8px] text-slate-400">Background
                  <span className="mt-1.5 flex h-9 items-center gap-2 rounded-lg border border-[#2a3749] bg-[#0a1421] px-2">
                    <input type="color" value={style.background} onChange={(event) => setStyle((current) => ({ ...current, background: event.target.value }))} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" />
                    <span className="truncate font-mono text-[8px] text-slate-300">{style.background}</span>
                  </span>
                </label>
                <label className="text-[8px] text-slate-400">Error correction <Info size={9} className="ml-1 inline" />
                  <select value={style.errorCorrection} onChange={(event) => setStyle((current) => ({ ...current, errorCorrection: event.target.value as QrStyle['errorCorrection'] }))} className={`${inputClass} mt-1.5 h-9 py-1`}>
                    <option value="L">L (Low)</option><option value="M">M (Medium)</option><option value="Q">Q (Quartile)</option><option value="H">H (High)</option>
                  </select>
                </label>
                <label className="text-[8px] text-slate-400">Export size
                  <select value={style.size} onChange={(event) => setStyle((current) => ({ ...current, size: Number(event.target.value) }))} className={`${inputClass} mt-1.5 h-9 py-1`}>
                    <option value={512}>512 px</option><option value={1024}>1024 px</option><option value={2048}>2048 px</option>
                  </select>
                </label>
              </div>
              <div role="status" className={`mt-3 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[8px] leading-relaxed ${hasScanFriendlyContrast ? 'border-emerald-500/20 bg-emerald-500/[.06] text-emerald-300' : 'border-amber-500/25 bg-amber-500/[.07] text-amber-300'}`}>
                {hasScanFriendlyContrast ? <ShieldCheck size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                <span>
                  <b>{contrastRatio.toFixed(1)}:1 contrast.</b>{' '}
                  {hasScanFriendlyContrast
                    ? 'Colors should remain easy for QR scanners to distinguish.'
                    : 'Increase the difference between foreground and background colors for more reliable scanning.'}
                </span>
              </div>
            </div>

            <button type="button" disabled={saving || (mode === 'single' ? !content.trim() : multiEntries.length === 0)} onClick={() => void (mode === 'single' ? saveSingle() : saveMulti())} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[linear-gradient(135deg,#ff625f,#f53f4c)] text-[10px] font-semibold text-white shadow-[0_8px_25px_rgba(255,67,76,.28)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40">
              {saving ? <Loader2 size={14} className="animate-spin" /> : editingId ? <Save size={14} /> : <Sparkles size={14} />}
              {saving ? 'Generating…' : editingId ? 'Save changes' : mode === 'multi' ? `Create ${multiEntries.length || ''} QR codes` : 'Create QR Code'}
            </button>
          </div>
        </div>

        <div className={`${panelClass} relative flex min-h-[450px] flex-col overflow-hidden p-5`}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,79,87,.13),transparent_42%)]" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-white">Live Preview</h2>
              <p className="mt-1 text-[9px] text-slate-400">{style.size} × {style.size} <span className="px-1.5">•</span> SVG <span className="px-1.5">•</span> Error correction {style.errorCorrection}</p>
            </div>
            <button type="button" onClick={() => foregroundRef.current?.click()} className="flex h-9 items-center gap-2 rounded-lg border border-[#2a3749] bg-[#101b2a] px-3 text-[9px] text-slate-300 hover:border-[#ff4f57]/40 hover:text-white"><WandSparkles size={12} /> Customize</button>
          </div>
          <div className="relative flex flex-1 items-center justify-center py-4">
            <div className="flex aspect-square w-full max-w-[285px] items-center justify-center overflow-hidden rounded-[30px] border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,.38)]" style={{ backgroundColor: style.background }}>
              {generating ? <Loader2 size={30} className="animate-spin text-[#ff4f57]" /> : styledPreview ? (
                <div className="h-full w-full p-5 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: styledPreview }} />
              ) : previewError ? (
                <div className="flex max-w-[190px] flex-col items-center gap-2 px-4 text-center text-[9px] leading-relaxed text-amber-600">
                  <AlertTriangle size={24} />
                  Preview unavailable. Edit the content to try again.
                </div>
              ) : <QrCode size={56} className="text-slate-300/30" />}
            </div>
          </div>
          <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button type="button" disabled={!currentPreviewRecord} onClick={() => currentPreviewRecord && exportPng(currentPreviewRecord)} className="flex h-9 items-center justify-center gap-2 rounded-lg border border-[#ff4f57] text-[9px] font-medium text-[#ff656c] hover:bg-[#ff4f57]/10 disabled:opacity-35"><Download size={12} /> Download PNG</button>
            <button type="button" disabled={!currentPreviewRecord} onClick={() => currentPreviewRecord && downloadSvg(currentPreviewRecord)} className="flex h-9 items-center justify-center gap-2 rounded-lg border border-[#2a3749] bg-[#101b2a] text-[9px] text-slate-300 hover:border-slate-500 disabled:opacity-35"><Download size={12} /> Download SVG</button>
            <button type="button" disabled={!content.trim()} onClick={() => void copyContent(content)} className="flex h-9 items-center justify-center gap-2 rounded-lg border border-[#2a3749] bg-[#101b2a] text-[9px] text-slate-300 hover:border-slate-500 disabled:opacity-35"><Copy size={12} /> Copy</button>
            <button type="button" disabled={!content.trim()} onClick={runTest} className="flex h-9 items-center justify-center gap-2 rounded-lg border border-[#2a3749] bg-[#101b2a] text-[9px] text-slate-300 hover:border-slate-500 disabled:opacity-35"><ExternalLink size={12} /> Test</button>
          </div>
        </div>
      </section>

      <section className={`${panelClass} mt-5 p-4`} aria-labelledby="qr-library-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><h2 id="qr-library-heading" className="text-[14px] font-semibold text-white">QR Library</h2><span className="rounded-md bg-[#1d2a3b] px-2 py-1 text-[8px] text-slate-300">{records.length}</span></div>
          <label className="relative block w-full max-w-[300px]"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search QR library" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-full rounded-lg border border-[#2a3749] bg-[#0d1725] pl-9 pr-3 text-[9px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-[#ff4f57]/50" placeholder="Search QR codes…" /></label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['all', 'url', 'text', 'wifi', 'contact', 'deep-link'] as LibraryFilter[]).map((value) => {
            const label = value === 'all' ? 'All' : typeOptions.find((option) => option.value === value)?.label || value
            return <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPageLimit(12) }} className={`h-8 rounded-lg border px-4 text-[9px] font-medium transition ${filter === value ? 'border-[#ff4f57] bg-[linear-gradient(135deg,#ff625f,#ed3e49)] text-white shadow-[0_6px_16px_rgba(255,73,80,.2)]' : 'border-[#2a3749] bg-[#111d2b] text-slate-400 hover:text-white'}`}>{label}</button>
          })}
        </div>

        {records.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#ff4f57]/20 bg-[#ff4f57]/[.07] text-[#ff5d65]"><QrCode size={24} /></span><h3 className="mt-4 text-sm font-semibold text-white">Your QR library is empty</h3><p className="mt-2 max-w-sm text-[10px] text-slate-500">Create a single QR code or paste a list to build your library.</p></div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex min-h-[160px] items-center justify-center text-[10px] text-slate-500">No QR codes match the current filter.</div>
        ) : (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(205px,1fr))] gap-3">
            {visibleRecords.map((record) => {
              const displaySvg = styleQrSvg(record.svg, { ...record.style, size: 220 })
              return (
                <article key={record.id} className="group relative rounded-xl border border-[#293649] bg-[linear-gradient(145deg,#182536,#132031)] p-3 transition hover:-translate-y-0.5 hover:border-[#3b4b60] hover:shadow-[0_15px_35px_rgba(0,0,0,.2)]">
                  <button type="button" onClick={() => toggleFavorite(record.id)} className={`absolute right-2.5 top-2.5 rounded p-1 ${record.favorite ? 'text-amber-400' : 'text-slate-500 hover:text-slate-200'}`} aria-label={`${record.favorite ? 'Unfavorite' : 'Favorite'} ${record.name}`}><Star size={13} fill={record.favorite ? 'currentColor' : 'none'} /></button>
                  <div className="flex gap-3 pr-4">
                    <div className="flex h-[78px] w-[78px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/10 p-1.5 shadow-sm" style={{ backgroundColor: record.style.background }}><div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: displaySvg }} /></div>
                    <div className="min-w-0 flex-1 py-1"><h3 className="line-clamp-2 min-h-[28px] text-[10px] font-semibold leading-snug text-white">{record.name}</h3><span className={`mt-2 inline-flex rounded-md px-2 py-1 text-[7px] font-medium ${typeBadgeClass(record.contentType)}`}>{typeOptions.find((option) => option.value === record.contentType)?.label}</span><p className="mt-1.5 whitespace-nowrap text-[7px] text-slate-500">{relativeDate(record.updatedAt)}</p></div>
                  </div>
                  <div className="mt-3 flex items-center justify-around border-t border-[#293649] pt-2">
                    <button type="button" onClick={() => exportPng(record)} title="Download PNG" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"><Download size={13} /></button>
                    <button type="button" onClick={() => void copyContent(record.content)} title="Copy content" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"><Copy size={13} /></button>
                    <div className="relative">
                      <button type="button" onClick={() => setActionMenuId((current) => current === record.id ? null : record.id)} title="More actions" aria-haspopup="menu" aria-expanded={actionMenuId === record.id} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"><MoreHorizontal size={14} /></button>
                      {actionMenuId === record.id && (
                        <div role="menu" className="absolute bottom-8 right-0 z-20 w-36 overflow-hidden rounded-lg border border-[#344258] bg-[#0d1725] p-1 shadow-2xl">
                          <button role="menuitem" type="button" onClick={() => startEdit(record)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[8px] text-slate-300 hover:bg-white/5"><Pencil size={11} /> Edit</button>
                          <button role="menuitem" type="button" onClick={() => duplicate(record)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[8px] text-slate-300 hover:bg-white/5"><CopyPlus size={11} /> Duplicate</button>
                          <button role="menuitem" type="button" onClick={() => { downloadSvg(record); setActionMenuId(null) }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[8px] text-slate-300 hover:bg-white/5"><FileCode2 size={11} /> Download SVG</button>
                          <button role="menuitem" type="button" onClick={() => remove(record)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[8px] text-red-400 hover:bg-red-500/10"><Trash2 size={11} /> Delete</button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {filteredRecords.length > pageLimit && (
          <div className="mt-4 flex justify-center"><button type="button" onClick={() => setPageLimit((current) => current + 12)} className="flex h-9 items-center gap-2 rounded-lg border border-[#2a3749] bg-[#101b2a] px-5 text-[9px] text-slate-400 hover:text-white">Load more <ChevronDown size={12} /></button></div>
        )}
      </section>

      {notice && <div role="status" className="fixed bottom-5 right-5 z-[var(--z-drawer)] flex items-center gap-2 rounded-xl border border-[#354257] bg-[#111c2a] px-4 py-3 text-[10px] text-white shadow-2xl"><Check size={13} className="text-emerald-400" />{notice}</div>}
    </div>
  )
}
