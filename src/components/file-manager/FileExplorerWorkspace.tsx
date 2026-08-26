import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpToLine,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileVideo,
  Filter,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  List,
  Loader2,
  Maximize2,
  Music,
  MoreVertical,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Upload,
  Wifi,
  X,
  Grid2X2,
  type LucideIcon,
} from 'lucide-react'
import { useFileManager } from '../../hooks/useFileManager'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import { useInView, useThumbnail } from '../../hooks/useThumbnail'
import { openPath, revealInFolder } from '../../services/screenshotService'
import { formatKb } from '../../types/deviceStatus'
import { breadcrumbs, formatSize, isImageFile, joinPath, LARGE_PREVIEW_BYTES, type FileEntry } from '../../types/fileManager'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface FileExplorerWorkspaceProps {
  fm: ReturnType<typeof useFileManager>
  activeDevice: string
  customPath?: string
  defaultDownloadDir: string
  confirmAction: (title: string, message: string, onConfirm: () => void) => void
  notify: ToolbarNotifier
}

type SortKey = 'name' | 'size' | 'modified'
type SortDir = 'asc' | 'desc'
type FilterType = 'all' | 'folders' | 'images' | 'videos' | 'other'

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|3gp|m4v)$/i
const ROW_HEIGHT = 52
const ROW_OVERSCAN = 10

const QUICK_ACCESS: { label: string; path: string; icon: LucideIcon }[] = [
  { label: 'Internal Storage', path: '/sdcard', icon: HardDrive },
  { label: 'Camera', path: '/sdcard/DCIM/Camera', icon: ImageIcon },
  { label: 'Pictures', path: '/sdcard/Pictures', icon: ImageIcon },
  { label: 'Download', path: '/sdcard/Download', icon: Download },
  { label: 'Movies', path: '/sdcard/Movies', icon: FileVideo },
  { label: 'Music', path: '/sdcard/Music', icon: Music },
]

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All items' },
  { value: 'folders', label: 'Folders only' },
  { value: 'other', label: 'Other files' },
]

const TYPE_TABS: { value: FilterType; label: string; icon: LucideIcon }[] = [
  { value: 'images', label: 'Images', icon: ImageIcon },
  { value: 'videos', label: 'Videos', icon: FileVideo },
]

function matchesFilter(entry: FileEntry, filter: FilterType): boolean {
  if (filter === 'all') return true
  if (filter === 'folders') return entry.isDir
  if (entry.isDir) return false
  if (filter === 'images') return isImageFile(entry.name)
  if (filter === 'videos') return VIDEO_EXT.test(entry.name)
  return !isImageFile(entry.name) && !VIDEO_EXT.test(entry.name)
}

function compareEntries(a: FileEntry, b: FileEntry, key: SortKey, dir: SortDir): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  let cmp = 0
  if (key === 'name') cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  else if (key === 'size') cmp = (a.size ?? 0) - (b.size ?? 0)
  else cmp = (a.modified ?? '').localeCompare(b.modified ?? '')
  return dir === 'asc' ? cmp : -cmp
}

export default function FileExplorerWorkspace({ fm, activeDevice, customPath, defaultDownloadDir, confirmAction, notify }: FileExplorerWorkspaceProps) {
  const [newFolder, setNewFolder] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [gridView, setGridView] = useState(false)
  const [visibleCount, setVisibleCount] = useState(200)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [showHidden, setShowHidden] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renamingName, setRenamingName] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [nav, setNav] = useState(() => ({ stack: [fm.cwd], index: 0 }))
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [pendingOpenName, setPendingOpenName] = useState<string | null>(null)
  const [openedName, setOpenedName] = useState<string | null>(null)
  const maxRenderedEntries = 200

  const { status } = useDeviceStatus({ activeDevice, customPath, autoRefresh: Boolean(activeDevice), intervalMs: 15000, enabled: Boolean(activeDevice) })

  const totalSize = useMemo(() => fm.entries.reduce((sum, entry) => sum + (entry.size || 0), 0), [fm.entries])
  const hiddenCount = useMemo(() => fm.entries.filter((entry) => entry.name.startsWith('.')).length, [fm.entries])
  const visibleEntries = useMemo(() => {
    const query = search.trim().toLowerCase()
    return fm.entries
      .filter((entry) => showHidden || !entry.name.startsWith('.'))
      .filter((entry) => matchesFilter(entry, filterType))
      .filter((entry) => (query ? entry.name.toLowerCase().includes(query) : true))
      .sort((a, b) => compareEntries(a, b, sortKey, sortDir))
  }, [fm.entries, search, filterType, sortKey, sortDir, showHidden])
  const selectedEntry = fm.entries.find((entry) => entry.name === selectedName) || fm.entries.find((entry) => !entry.isDir && isImageFile(entry.name)) || fm.entries[0]
  const renderedEntries = visibleEntries.slice(0, visibleCount)
  const crumbs = breadcrumbs(fm.cwd)
  const checkedCount = checkedNames.size
  const allVisibleChecked = visibleEntries.length > 0 && visibleEntries.every((entry) => checkedNames.has(entry.name))
  const activeQuickPath = useMemo(() => {
    const matches = QUICK_ACCESS.filter((item) => fm.cwd === item.path || fm.cwd.startsWith(`${item.path}/`))
    return matches.sort((a, b) => b.path.length - a.path.length)[0]?.path
  }, [fm.cwd])
  const canGoBack = nav.index > 0
  const canGoForward = nav.index < nav.stack.length - 1

  useEffect(() => {
    setVisibleCount(maxRenderedEntries)
    setCheckedNames(new Set())
    setMenuFor(null)
    setRenamingName(null)
    setFilterOpen(false)
  }, [search, fm.cwd])

  useEffect(() => {
    setLightboxOpen(false)
    setOpenedName(null)
  }, [selectedName, fm.cwd])

  useEffect(() => {
    if (!lightboxOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxOpen])

  // Fires once a pulled file (queued via handleOpenFile) is ready, so the OS
  // hand-off happens exactly once regardless of how long the pull took.
  useEffect(() => {
    if (!pendingOpenName) return
    if (fm.previewName !== pendingOpenName) return
    if (fm.previewLoading) return
    if (fm.previewLocalPath && !fm.previewError) {
      void openPath(fm.previewLocalPath)
      setOpenedName(pendingOpenName)
    }
    if (fm.previewError) notify('Open failed', fm.previewError, 'error')
    setPendingOpenName(null)
  }, [pendingOpenName, fm.previewName, fm.previewLocalPath, fm.previewLoading, fm.previewError, notify])

  const navigate = useCallback((path: string) => {
    if (path === fm.cwd) return
    fm.goTo(path)
    setNav((prev) => {
      if (prev.stack[prev.index] === path) return prev
      const trimmed = prev.stack.slice(0, prev.index + 1)
      trimmed.push(path)
      return { stack: trimmed, index: trimmed.length - 1 }
    })
  }, [fm])

  const goBack = useCallback(() => {
    setNav((prev) => {
      if (prev.index <= 0) return prev
      const index = prev.index - 1
      fm.goTo(prev.stack[index])
      return { ...prev, index }
    })
  }, [fm])

  const goForward = useCallback(() => {
    setNav((prev) => {
      if (prev.index >= prev.stack.length - 1) return prev
      const index = prev.index + 1
      fm.goTo(prev.stack[index])
      return { ...prev, index }
    })
  }, [fm])

  const handlePush = async () => {
    const chosen = await openDialog({ multiple: false }).catch(() => null)
    if (typeof chosen !== 'string') return
    const result = await fm.push(chosen)
    if (!result.success) notify('Upload failed', result.error || 'Unknown error', 'error')
  }

  const handleOpenFile = (entry: FileEntry) => {
    if (entry.isDir) return
    setSelectedName(entry.name)
    if (fm.previewLocalPath && fm.previewName === entry.name && !fm.previewError) {
      void openPath(fm.previewLocalPath)
      setOpenedName(entry.name)
      return
    }
    setPendingOpenName(entry.name)
    void fm.preview(entry, LARGE_PREVIEW_BYTES)
  }

  const handlePull = async (entry: FileEntry) => {
    const chosen = await openDialog({ directory: true, multiple: false, defaultPath: defaultDownloadDir || undefined }).catch(() => null)
    const target = typeof chosen === 'string' ? chosen : defaultDownloadDir
    if (!target) return
    const result = await fm.pull(entry, target)
    if (!result.success) notify('Download failed', result.error || 'Unknown error', 'error')
  }

  const handleDelete = (entry: FileEntry) => confirmAction('Delete item', `Delete ${entry.name}?`, async () => {
    const result = await fm.remove(entry)
    if (!result.success) notify('Delete failed', result.error || 'Unknown error', 'error')
    else if (selectedName === entry.name) setSelectedName(null)
  })

  const handleBulkPull = async () => {
    const targets = fm.entries.filter((entry) => checkedNames.has(entry.name))
    if (!targets.length) return
    const chosen = await openDialog({ directory: true, multiple: false, defaultPath: defaultDownloadDir || undefined }).catch(() => null)
    const target = typeof chosen === 'string' ? chosen : defaultDownloadDir
    if (!target) return
    for (const entry of targets) {
      const result = await fm.pull(entry, target)
      if (!result.success) notify('Download failed', `${entry.name}: ${result.error || 'Unknown error'}`, 'error')
    }
  }

  const handleBulkDelete = () => {
    const targets = fm.entries.filter((entry) => checkedNames.has(entry.name))
    if (!targets.length) return
    confirmAction('Delete items', `Delete ${targets.length} selected item${targets.length > 1 ? 's' : ''}?`, async () => {
      const failures = await fm.removeMany(targets)
      for (const { entry, error } of failures) {
        notify('Delete failed', `${entry.name}: ${error || 'Unknown error'}`, 'error')
      }
      setCheckedNames(new Set())
    })
  }

  const handleMkdir = async () => {
    const name = newFolder.trim()
    if (!name) return
    const result = await fm.mkdir(name)
    if (result.success) {
      setNewFolder('')
      setShowNewFolder(false)
    } else notify('Create folder failed', result.error || 'Unknown error', 'error')
  }

  const toggleChecked = (name: string) => {
    setCheckedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleCheckAll = () => {
    setCheckedNames((prev) => {
      if (allVisibleChecked) {
        const next = new Set(prev)
        for (const entry of visibleEntries) next.delete(entry.name)
        return next
      }
      const next = new Set(prev)
      for (const entry of visibleEntries) next.add(entry.name)
      return next
    })
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const startRename = (entry: FileEntry) => {
    setRenamingName(entry.name)
    setRenameValue(entry.name)
    setMenuFor(null)
  }

  const submitRename = async (entry: FileEntry) => {
    const value = renameValue.trim()
    if (!value || value === entry.name) {
      setRenamingName(null)
      return
    }
    const result = await fm.rename(entry, value)
    if (result.success) {
      setRenamingName(null)
      if (selectedName === entry.name) setSelectedName(value)
    } else {
      notify('Rename failed', result.error || 'Unknown error', 'error')
    }
  }

  const copyPath = async (entry: FileEntry) => {
    const full = joinPath(fm.cwd, entry.name)
    try {
      await navigator.clipboard.writeText(full)
      notify('Path copied', full, 'success')
    } catch (error) {
      notify('Copy failed', String(error), 'error')
    }
    setMenuFor(null)
  }

  const openEntry = (entry: FileEntry) => {
    if (renamingName === entry.name) return
    setSelectedName(entry.name)
    if (entry.isDir || entry.isLink) navigate(joinPath(fm.cwd, entry.name))
    else if (isImageFile(entry.name)) void fm.preview(entry)
  }

  const closeOverlays = () => {
    setFilterOpen(false)
    setMenuFor(null)
  }

  const previewMatches = Boolean(selectedEntry) && fm.previewName === selectedEntry?.name
  const previewBusy = previewMatches && fm.previewLoading
  const previewFailed = previewMatches && Boolean(fm.previewError)
  const previewReady = previewMatches && Boolean(fm.previewLocalPath) && !fm.previewError

  return (
    <>
    <div className="flex h-full min-h-[420px] w-full flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1725] text-slate-200 shadow-[0_18px_45px_rgba(0,0,0,.24)]">
      <div className="grid min-h-0 flex-1 lg:grid-cols-[190px_minmax(360px,1fr)_250px] xl:grid-cols-[232px_minmax(440px,1fr)_330px]">
        <aside className="min-h-0 overflow-y-auto custom-scrollbar border-b border-white/[0.07] bg-[#0b1421]/80 p-3 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">Explorer</h2>
            <button type="button" onClick={fm.refresh} disabled={fm.loading || !activeDevice} title="Refresh" className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-violet-300 disabled:opacity-40">
              <RefreshCw size={14} className={fm.loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="mb-4 flex w-full items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.035] p-2.5 text-left">
            <HardDrive size={17} className="text-sky-400" />
            <span className="min-w-0 flex-1">
              <strong className="block text-[10px] font-semibold text-slate-200">Internal Storage</strong>
              <span className="text-[8px] text-slate-500">{fm.entries.length ? `${formatSize(totalSize) || '0 B'} in ${fm.entries.length} items` : 'Device storage'}</span>
            </span>
          </div>
          <div className="space-y-0.5">
            {QUICK_ACCESS.map((item) => (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                disabled={!activeDevice}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px] font-medium transition-colors disabled:opacity-40 ${activeQuickPath === item.path ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`}
              >
                <item.icon size={14} className={activeQuickPath === item.path ? 'text-violet-300' : 'text-slate-500'} />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-white/[0.07] bg-gradient-to-br from-sky-500/[0.08] to-violet-500/[0.07] p-3">
            <div className="flex items-center gap-2">
              <Wifi size={15} className="text-sky-400" />
              <span className="text-[9px] font-semibold text-slate-300">{activeDevice ? 'Connected via ADB' : 'No device connected'}</span>
            </div>
            <p className="mt-1 truncate text-[8px] text-slate-500">{activeDevice || 'Select a device to browse files'}</p>
            <StorageBar status={status} className="mt-3" />
            <button type="button" onClick={fm.refresh} disabled={!activeDevice} className="mt-3 h-7 w-full rounded-md bg-violet-600 text-[9px] font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-40">Refresh Storage</button>
          </div>
        </aside>

        <main className="flex min-h-[360px] min-w-0 flex-col overflow-hidden bg-[#0d1725] lg:min-h-0">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.07] px-4 py-3">
            <button type="button" onClick={goBack} disabled={!canGoBack} className="rounded-md p-1 text-slate-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-30"><ArrowLeft size={16} /></button>
            <button type="button" onClick={goForward} disabled={!canGoForward} className="rounded-md p-1 text-slate-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-30"><ArrowRight size={16} /></button>
            <button type="button" onClick={() => navigate(parentPathSafe(fm.cwd))} disabled={fm.cwd === '/'} className="rounded-md p-1 text-slate-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-30"><ArrowUpToLine size={16} /></button>
            {crumbs.slice(-4).map((crumb, index) => (
              <span key={crumb.path} className="flex items-center gap-2">
                <ChevronRight size={12} className="text-slate-600" />
                <button type="button" onClick={() => navigate(crumb.path)} className={`text-[10px] ${index === crumbs.slice(-4).length - 1 ? 'font-semibold text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>{crumb.label}</button>
              </span>
            ))}
            <button type="button" onClick={fm.refresh} className="ml-auto rounded-lg border border-white/[0.08] p-1.5 text-slate-400 hover:border-violet-400/40 hover:text-violet-300"><RefreshCw size={14} className={fm.loading ? 'animate-spin' : ''} /></button>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.07] px-4 py-3">
            <button type="button" onClick={handlePush} disabled={!activeDevice || fm.busy} className="flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[10px] font-semibold text-white shadow-[0_5px_15px_rgba(124,77,255,.2)] hover:bg-violet-500 disabled:opacity-40"><Upload size={13} />Upload</button>
            <button type="button" onClick={() => setShowNewFolder((value) => !value)} disabled={!activeDevice} className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-medium text-slate-300 hover:border-violet-400/40 hover:text-violet-300 disabled:opacity-40"><FolderPlus size={13} />New Folder</button>

            {checkedCount > 0 ? (
              <>
                <span className="flex h-8 items-center rounded-md border border-violet-400/30 bg-violet-500/10 px-2.5 text-[10px] font-semibold text-violet-200">{checkedCount} selected</span>
                <button type="button" onClick={() => void handleBulkPull()} disabled={fm.busy} className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-medium text-slate-300 hover:border-violet-400/40 hover:text-violet-300 disabled:opacity-40"><Download size={13} />Download</button>
                <button type="button" onClick={handleBulkDelete} disabled={fm.busy} className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-medium text-slate-300 hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"><Trash2 size={13} />Delete</button>
                <button type="button" onClick={() => setCheckedNames(new Set())} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium text-slate-500 hover:text-slate-300">Clear</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => selectedEntry && void handlePull(selectedEntry)} disabled={!selectedEntry || !activeDevice || fm.busy} className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-medium text-slate-300 hover:border-violet-400/40 hover:text-violet-300 disabled:opacity-40"><Download size={13} />Download</button>
                <button type="button" onClick={() => selectedEntry && handleDelete(selectedEntry)} disabled={!selectedEntry || !activeDevice || fm.busy} className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-medium text-slate-300 hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"><Trash2 size={13} />Delete</button>
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              <div className="flex h-8 items-center gap-0.5 rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5">
                <button type="button" onClick={() => setFilterType('all')} className={`rounded px-2 py-1 text-[9px] font-medium transition-colors ${filterType === 'all' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-400 hover:text-slate-200'}`}>All</button>
                {TYPE_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setFilterType((value) => (value === tab.value ? 'all' : tab.value))}
                    title={`${tab.label} only`}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-[9px] font-medium transition-colors ${filterType === tab.value ? 'bg-violet-500/20 text-violet-300' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <tab.icon size={11} />
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="flex h-8 items-center gap-2 rounded-md border border-white/[0.08] bg-black/10 px-2.5 text-slate-500">
                <Search size={13} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search in this folder" placeholder="Search in this folder..." className="w-28 bg-transparent text-[9px] text-slate-200 outline-none placeholder:text-slate-600 sm:w-36" />
              </div>
              <div className="relative">
                <button type="button" onClick={() => setFilterOpen((value) => !value)} className={`rounded-md border p-2 transition-colors ${filterType !== 'all' || showHidden ? 'border-violet-400/40 text-violet-300' : 'border-white/[0.08] text-slate-400 hover:text-violet-300'}`}>
                  <Filter size={13} />
                </button>
                {filterOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={closeOverlays} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-white/[0.08] bg-[#101a2b] py-1 shadow-[0_12px_30px_rgba(0,0,0,.35)]">
                      {FILTER_OPTIONS.map((option) => (
                        <button key={option.value} type="button" onClick={() => { setFilterType(option.value); setFilterOpen(false) }} className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] ${filterType === option.value ? 'text-violet-300' : 'text-slate-300 hover:bg-white/[0.05]'}`}>
                          {option.label}
                          {filterType === option.value && <Check size={12} />}
                        </button>
                      ))}
                      <div className="my-1 border-t border-white/[0.07]" />
                      <button type="button" onClick={() => setShowHidden((value) => !value)} className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] ${showHidden ? 'text-violet-300' : 'text-slate-300 hover:bg-white/[0.05]'}`}>
                        <span className="flex items-center gap-1.5">
                          {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                          Hidden files{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
                        </span>
                        {showHidden && <Check size={12} />}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button type="button" onClick={() => setGridView(false)} className={`rounded-md p-1.5 ${!gridView ? 'bg-violet-500/15 text-violet-300' : 'text-slate-500'}`}><List size={15} /></button>
              <button type="button" onClick={() => setGridView(true)} className={`rounded-md p-1.5 ${gridView ? 'bg-violet-500/15 text-violet-300' : 'text-slate-500'}`}><Grid2X2 size={14} /></button>
            </div>
          </div>

          {showNewFolder && (
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] bg-black/10 px-4 py-2">
              <input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="Folder name" className="h-8 flex-1 rounded-md border border-white/[0.08] bg-black/20 px-2 text-[10px] text-slate-200 outline-none focus:border-violet-400/50" />
              <button type="button" onClick={handleMkdir} disabled={!newFolder.trim()} className="h-8 rounded-md bg-violet-600 px-3 text-[9px] font-semibold text-white disabled:opacity-40">Create</button>
              <button type="button" onClick={() => setShowNewFolder(false)} className="p-1 text-slate-500"><X size={14} /></button>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
            {!activeDevice ? <EmptyState label="No device connected" /> : fm.loading && fm.entries.length === 0 ? <EmptyState label="Loading files..." loading /> : fm.error ? <EmptyState label={fm.error} /> : (
              <>
                {gridView ? (
                  <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {renderedEntries.map((entry) => (
                        <GridEntry
                          key={entry.name}
                          entry={entry}
                          cwd={fm.cwd}
                          serial={activeDevice}
                          customPath={customPath}
                          selected={entry.name === selectedEntry?.name}
                          checked={checkedNames.has(entry.name)}
                          onOpen={openEntry}
                          onToggleCheck={() => toggleChecked(entry.name)}
                          menuOpen={menuFor === entry.name}
                          onToggleMenu={() => setMenuFor((value) => (value === entry.name ? null : entry.name))}
                          onCloseMenu={() => setMenuFor(null)}
                          onPull={handlePull}
                          onDelete={handleDelete}
                          onRename={startRename}
                          onCopyPath={copyPath}
                          onOpenExternal={handleOpenFile}
                        />
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-3 text-[9px] text-slate-500">
                      <span>{visibleEntries.length ? `1 - ${renderedEntries.length} of ${visibleEntries.length} items` : 'No matching items'}</span>
                      {renderedEntries.length < visibleEntries.length && <button type="button" onClick={() => setVisibleCount((count) => count + maxRenderedEntries)} className="rounded-md border border-white/[0.08] px-2 py-1 text-violet-300 hover:border-violet-400/40">Show more</button>}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid shrink-0 grid-cols-[28px_minmax(180px,1fr)_90px_100px_105px_32px] items-center rounded-lg border border-white/[0.07] bg-white/[0.035] px-2 py-2 text-[9px] font-semibold text-slate-400">
                      <button type="button" onClick={toggleCheckAll} aria-label="Select all files" className="flex items-center justify-center text-slate-400 hover:text-violet-300">
                        {allVisibleChecked ? <CheckSquare size={14} className="text-violet-400" /> : <Square size={14} />}
                      </button>
                      <SortHeader label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                      <SortHeader label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                      <span>Type</span>
                      <SortHeader label="Modified" sortKey="modified" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                      <span />
                    </div>
                    {visibleEntries.length === 0 ? <EmptyState label="No matching items" /> : (
                      <VirtualList
                        items={visibleEntries}
                        itemKey={(entry) => entry.name}
                        rowHeight={ROW_HEIGHT}
                        overscan={ROW_OVERSCAN}
                        className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
                        renderItem={(entry) => (
                          <FileRow
                            entry={entry}
                            cwd={fm.cwd}
                            serial={activeDevice}
                            customPath={customPath}
                            selected={entry.name === selectedEntry?.name}
                            checked={checkedNames.has(entry.name)}
                            onOpen={openEntry}
                            onToggleCheck={() => toggleChecked(entry.name)}
                            onPull={handlePull}
                            onDelete={handleDelete}
                            onOpenExternal={handleOpenFile}
                            menuOpen={menuFor === entry.name}
                            onToggleMenu={() => setMenuFor((value) => (value === entry.name ? null : entry.name))}
                            onCloseMenu={() => setMenuFor(null)}
                            renaming={renamingName === entry.name}
                            renameValue={renameValue}
                            onRenameChange={setRenameValue}
                            onRenameStart={startRename}
                            onRenameSubmit={submitRename}
                            onRenameCancel={() => setRenamingName(null)}
                            onCopyPath={copyPath}
                          />
                        )}
                      />
                    )}
                    <div className="shrink-0 pt-2 text-[9px] text-slate-500">{visibleEntries.length} item{visibleEntries.length === 1 ? '' : 's'}</div>
                  </>
                )}
              </>
            )}
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto custom-scrollbar border-t border-white/[0.07] bg-[#0b1421]/75 p-3 lg:border-l lg:border-t-0">
          <div className="relative flex h-52 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-slate-900">
            {!selectedEntry ? null : selectedEntry.isDir ? (
              <div className="flex flex-col items-center gap-2 text-slate-600">
                <FolderOpen size={40} />
                <span className="text-[9px] font-medium uppercase tracking-wider">Folder</span>
              </div>
            ) : isImageFile(selectedEntry.name) ? (
              previewBusy ? (
                <Loader2 size={22} className="animate-spin text-violet-300" />
              ) : previewFailed ? (
                <div className="px-4 text-center text-[9px] leading-relaxed text-amber-300">{fm.previewError}</div>
              ) : previewReady ? (
                <button type="button" onClick={() => setLightboxOpen(true)} className="group relative h-full w-full cursor-zoom-in" title="View original size">
                  <img src={convertFileSrc(fm.previewLocalPath!)} alt={fm.previewName ?? selectedEntry.name} className="h-full w-full object-contain" />
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[8px] font-medium text-white/85 opacity-0 transition-opacity group-hover:opacity-100">
                    <Maximize2 size={11} /> View original
                  </span>
                </button>
              ) : (
                <button type="button" onClick={() => void fm.preview(selectedEntry)} className="flex flex-col items-center gap-2 text-slate-600 hover:text-slate-400">
                  <ImageIcon size={40} />
                  <span className="text-[9px] font-medium uppercase tracking-wider">Click to load preview</span>
                </button>
              )
            ) : VIDEO_EXT.test(selectedEntry.name) ? (
              previewBusy ? (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <Loader2 size={22} className="animate-spin text-violet-300" />
                  <span className="text-[9px] font-medium uppercase tracking-wider">Loading video…</span>
                </div>
              ) : previewFailed ? (
                <div className="px-4 text-center text-[9px] leading-relaxed text-amber-300">{fm.previewError}</div>
              ) : previewReady ? (
                <video src={convertFileSrc(fm.previewLocalPath!)} controls className="h-full w-full bg-black object-contain" />
              ) : (
                <button type="button" onClick={() => void fm.preview(selectedEntry, LARGE_PREVIEW_BYTES)} className="flex flex-col items-center gap-2 text-slate-600 hover:text-slate-400">
                  <Play size={40} />
                  <span className="text-[9px] font-medium uppercase tracking-wider">Play video</span>
                </button>
              )
            ) : (
              previewBusy ? (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <Loader2 size={22} className="animate-spin text-violet-300" />
                  <span className="text-[9px] font-medium uppercase tracking-wider">Opening…</span>
                </div>
              ) : previewFailed ? (
                <div className="px-4 text-center text-[9px] leading-relaxed text-amber-300">{fm.previewError}</div>
              ) : previewReady && openedName === selectedEntry.name ? (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <File size={40} />
                  <span className="text-[9px] font-medium uppercase tracking-wider">Opened with default app</span>
                  <button type="button" onClick={() => void revealInFolder(fm.previewLocalPath!)} className="mt-1 rounded-md border border-white/[0.1] px-2 py-1 text-[8px] text-slate-400 hover:border-violet-400/40 hover:text-violet-300">Show in folder</button>
                </div>
              ) : (
                <button type="button" onClick={() => handleOpenFile(selectedEntry)} className="flex flex-col items-center gap-2 text-slate-600 hover:text-slate-400">
                  <ExternalLink size={40} />
                  <span className="text-[9px] font-medium uppercase tracking-wider">Open with default app</span>
                </button>
              )
            )}
          </div>
          {selectedEntry ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <Thumbnail entry={selectedEntry} cwd={fm.cwd} serial={activeDevice} customPath={customPath} />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[10px] font-semibold text-slate-200">{selectedEntry.name}</strong>
                  <span className="text-[9px] text-slate-500">{entryType(selectedEntry)} <span className="mx-1">•</span> {formatSize(selectedEntry.size) || '—'}</span>
                </div>
                <button type="button" onClick={() => startRename(selectedEntry)} title="Rename" className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.05] hover:text-violet-300"><Pencil size={14} /></button>
              </div>
              {renamingName === selectedEntry.name && (
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void submitRename(selectedEntry)
                      if (event.key === 'Escape') setRenamingName(null)
                    }}
                    className="h-7 flex-1 rounded-md border border-violet-400/40 bg-black/30 px-2 text-[10px] text-slate-100 outline-none"
                  />
                  <button type="button" onClick={() => void submitRename(selectedEntry)} className="rounded-md p-1 text-emerald-400 hover:bg-white/[0.05]"><Check size={14} /></button>
                  <button type="button" onClick={() => setRenamingName(null)} className="rounded-md p-1 text-slate-500 hover:bg-white/[0.05]"><X size={14} /></button>
                </div>
              )}
              <dl className="mt-4 space-y-2 border-t border-white/[0.07] pt-3 text-[9px]">
                <InfoRow label="Path" value={joinPath(fm.cwd, selectedEntry.name)} />
                <InfoRow label="Modified" value={selectedEntry.modified || '—'} />
                <InfoRow label="Size" value={formatSize(selectedEntry.size) || '—'} />
                <InfoRow label="MIME Type" value={mimeType(selectedEntry)} />
              </dl>
              <div className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
                <p className="mb-3 text-[10px] font-semibold text-slate-200">File Actions</p>
                <div className="grid grid-cols-4 gap-1">
                  <FileAction icon={ArrowDownToLine} label="Download" onClick={() => void handlePull(selectedEntry)} color="text-sky-400 bg-sky-500/10" />
                  <FileAction icon={Copy} label="Copy Path" onClick={() => void copyPath(selectedEntry)} color="text-violet-400 bg-violet-500/10" />
                  <FileAction icon={Pencil} label="Rename" onClick={() => startRename(selectedEntry)} color="text-amber-400 bg-amber-500/10" />
                  <FileAction icon={Trash2} label="Delete" onClick={() => handleDelete(selectedEntry)} color="text-red-400 bg-red-500/10" />
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-slate-200">Device Storage</p>
                  <HardDrive size={13} className="text-slate-500" />
                </div>
                <StorageBar status={status} className="mt-3" detailed />
              </div>
            </>
          ) : <EmptyState label="Select a file to preview" />}
        </aside>
      </div>
    </div>
    {lightboxOpen && selectedEntry && fm.previewLocalPath && fm.previewName === selectedEntry.name && (
      <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 p-6" onClick={() => setLightboxOpen(false)}>
        <button type="button" onClick={() => setLightboxOpen(false)} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20">
          <X size={20} />
        </button>
        <img
          src={convertFileSrc(fm.previewLocalPath)}
          alt={selectedEntry.name}
          className="max-h-full max-w-full object-contain"
          onClick={(event) => event.stopPropagation()}
        />
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md bg-black/55 px-3 py-1.5 text-[10px] text-white/85">
          <span>{selectedEntry.name}</span>
          <span className="text-white/50">•</span>
          <span>{formatSize(selectedEntry.size) || '—'}</span>
        </div>
      </div>
    )}
    </>
  )
}

/**
 * Fixed-row-height virtualizer: renders only the rows within (and just
 * beyond) the visible viewport, padding the rest so scrollbar size/position
 * stay correct. Keeps large folders (10k+ files) fast without paging.
 */
function VirtualList<T>({
  items, itemKey, rowHeight, overscan = 6, className, renderItem,
}: {
  items: T[]
  itemKey: (item: T) => string
  rowHeight: number
  overscan?: number
  className?: string
  renderItem: (item: T) => React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    const resizeObserver = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    resizeObserver.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    setViewportHeight(el.clientHeight)
    return () => {
      el.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
    }
  }, [])

  const total = items.length
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  const end = Math.min(total, start + Math.max(visibleRows, 1))
  const topPad = start * rowHeight
  const bottomPad = Math.max(0, (total - end) * rowHeight)

  return (
    <div ref={containerRef} className={className}>
      <div style={{ paddingTop: topPad, paddingBottom: bottomPad }}>
        {items.slice(start, end).map((item) => (
          <div key={itemKey(item)} style={{ height: rowHeight }} className="border-b border-white/[0.06] last:border-b-0">
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  )
}

function StorageBar({ status, className = '', detailed = false }: { status: ReturnType<typeof useDeviceStatus>['status']; className?: string; detailed?: boolean }) {
  const used = status?.storageUsedKb
  const total = status?.storageTotalKb
  const pct = used !== undefined && total ? Math.min(100, Math.round((used / total) * 100)) : undefined
  return (
    <div className={className}>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-400" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[9px]">
        <span className="text-violet-300">{pct !== undefined ? `${pct}% used` : '—'}</span>
        <span className="text-slate-400">{detailed ? (used !== undefined ? `${formatKb(used)} / ${formatKb(total)}` : '—') : ''}</span>
      </div>
    </div>
  )
}

function SortHeader({ label, sortKey, activeKey, dir, onSort }: { label: string; sortKey: SortKey; activeKey: SortKey; dir: SortDir; onSort: (key: SortKey) => void }) {
  const active = sortKey === activeKey
  return (
    <button type="button" onClick={() => onSort(sortKey)} className={`flex items-center gap-1 text-left ${active ? 'text-violet-300' : 'text-slate-400 hover:text-slate-200'}`}>
      {label}
      {active ? (dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : null}
    </button>
  )
}

function RowMenu({ entry, onPull, onDelete, onRename, onCopyPath, onOpenExternal, onClose }: { entry: FileEntry; onPull: (entry: FileEntry) => void; onDelete: (entry: FileEntry) => void; onRename: (entry: FileEntry) => void; onCopyPath: (entry: FileEntry) => void; onOpenExternal: (entry: FileEntry) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-white/[0.08] bg-[#101a2b] py-1 text-left shadow-[0_12px_30px_rgba(0,0,0,.35)]">
        {!entry.isDir && <MenuItem icon={ExternalLink} label="Open with default app" onClick={() => onOpenExternal(entry)} />}
        {!entry.isDir && <MenuItem icon={Download} label="Download" onClick={() => onPull(entry)} />}
        <MenuItem icon={Pencil} label="Rename" onClick={() => onRename(entry)} />
        <MenuItem icon={Copy} label="Copy path" onClick={() => onCopyPath(entry)} />
        <MenuItem icon={Trash2} label="Delete" tone="danger" onClick={() => onDelete(entry)} />
      </div>
    </>
  )
}

function MenuItem({ icon: Icon, label, onClick, tone = 'default' }: { icon: LucideIcon; label: string; onClick: () => void; tone?: 'default' | 'danger' }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-1.5 text-[10px] ${tone === 'danger' ? 'text-red-300 hover:bg-red-500/10' : 'text-slate-300 hover:bg-white/[0.05]'}`}>
      <Icon size={12} />
      {label}
    </button>
  )
}

function FileRow({
  entry, cwd, serial, customPath, selected, checked, onOpen, onToggleCheck, onPull, onDelete, onOpenExternal,
  menuOpen, onToggleMenu, onCloseMenu, renaming, renameValue, onRenameChange, onRenameStart, onRenameSubmit, onRenameCancel, onCopyPath,
}: {
  entry: FileEntry
  cwd: string
  serial: string
  customPath?: string
  selected: boolean
  checked: boolean
  onOpen: (entry: FileEntry) => void
  onToggleCheck: () => void
  onPull: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
  onOpenExternal: (entry: FileEntry) => void
  menuOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
  renaming: boolean
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameStart: (entry: FileEntry) => void
  onRenameSubmit: (entry: FileEntry) => void
  onRenameCancel: () => void
  onCopyPath: (entry: FileEntry) => void
}) {
  return (
    <div className={`grid grid-cols-[28px_minmax(180px,1fr)_90px_100px_105px_32px] items-center px-2 py-2 text-left transition-colors ${selected ? 'bg-violet-500/[0.1]' : 'hover:bg-violet-500/[0.06]'}`}>
      <button type="button" onClick={onToggleCheck} aria-label={`Select ${entry.name}`} className="flex items-center justify-center text-slate-500 hover:text-violet-300">
        {checked ? <CheckSquare size={14} className="text-violet-400" /> : <Square size={14} />}
      </button>
      {renaming ? (
        <div className="flex min-w-0 items-center gap-1.5 pr-2">
          <Thumbnail entry={entry} cwd={cwd} serial={serial} customPath={customPath} />
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => onRenameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onRenameSubmit(entry)
              if (event.key === 'Escape') onRenameCancel()
            }}
            className="h-6 min-w-0 flex-1 rounded border border-violet-400/40 bg-black/30 px-1.5 text-[10px] text-slate-100 outline-none"
          />
          <button type="button" onClick={() => onRenameSubmit(entry)} className="text-emerald-400"><Check size={13} /></button>
          <button type="button" onClick={onRenameCancel} className="text-slate-500"><X size={13} /></button>
        </div>
      ) : (
        <button type="button" onClick={() => onOpen(entry)} className="flex min-w-0 items-center gap-2 text-left">
          <Thumbnail entry={entry} cwd={cwd} serial={serial} customPath={customPath} />
          <span className="min-w-0 truncate text-[10px] font-medium text-slate-300">{entry.name}</span>
        </button>
      )}
      <span className="text-[9px] text-slate-400">{entry.isDir ? '—' : formatSize(entry.size) || '—'}</span>
      <span className="text-[9px] text-slate-400">{entryType(entry)}</span>
      <span className="truncate text-[9px] text-slate-400">{entry.modified || '—'}</span>
      <div className="relative flex justify-end">
        <button type="button" onClick={onToggleMenu} className="text-slate-500 hover:text-violet-300" aria-label={`Actions for ${entry.name}`}><MoreVertical size={14} /></button>
        {menuOpen && <RowMenu entry={entry} onPull={onPull} onDelete={onDelete} onRename={onRenameStart} onCopyPath={onCopyPath} onOpenExternal={onOpenExternal} onClose={onCloseMenu} />}
      </div>
    </div>
  )
}

function GridEntry({
  entry, cwd, serial, customPath, selected, checked, onOpen, onToggleCheck, menuOpen, onToggleMenu, onCloseMenu, onPull, onDelete, onRename, onCopyPath, onOpenExternal,
}: {
  entry: FileEntry
  cwd: string
  serial: string
  customPath?: string
  selected: boolean
  checked: boolean
  onOpen: (entry: FileEntry) => void
  onToggleCheck: () => void
  menuOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
  onPull: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
  onRename: (entry: FileEntry) => void
  onCopyPath: (entry: FileEntry) => void
  onOpenExternal: (entry: FileEntry) => void
}) {
  return (
    <div className={`group relative rounded-lg border p-3 text-left ${selected ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/[0.07] bg-white/[0.025] hover:border-violet-400/30'}`}>
      <button type="button" onClick={onToggleCheck} aria-label={`Select ${entry.name}`} className="absolute left-2 top-2 z-10 text-slate-400 hover:text-violet-300">
        {checked ? <CheckSquare size={14} className="text-violet-400 drop-shadow" /> : <Square size={14} className="opacity-0 drop-shadow group-hover:opacity-100" />}
      </button>
      <div className="relative">
        <button type="button" onClick={onToggleMenu} aria-label={`Actions for ${entry.name}`} className="absolute right-0 top-0 z-10 rounded p-1 text-slate-400 hover:text-violet-300"><MoreVertical size={13} /></button>
        {menuOpen && <RowMenu entry={entry} onPull={onPull} onDelete={onDelete} onRename={onRename} onCopyPath={onCopyPath} onOpenExternal={onOpenExternal} onClose={onCloseMenu} />}
      </div>
      <button type="button" onClick={() => onOpen(entry)} className="block w-full text-left">
        <Thumbnail entry={entry} cwd={cwd} serial={serial} customPath={customPath} large />
        <span className="mt-2 block truncate text-[10px] text-slate-300">{entry.name}</span>
        <span className="text-[9px] text-slate-500">{formatSize(entry.size) || entryType(entry)}</span>
      </button>
    </div>
  )
}

function Thumbnail({ entry, cwd, serial, customPath, large = false }: { entry: FileEntry; cwd?: string; serial?: string; customPath?: string; large?: boolean }) {
  const [ref, inView] = useInView<HTMLSpanElement>()
  const image = !entry.isDir && isImageFile(entry.name)
  const remotePath = cwd ? joinPath(cwd, entry.name) : ''
  const canFetch = image && Boolean(remotePath) && Boolean(serial)
  const { localPath } = useThumbnail(remotePath, entry.size, serial ?? '', customPath, canFetch && inView)

  if (entry.isDir) return <span className={`flex shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-400 ${large ? 'h-24 w-full' : 'h-9 w-10'}`}><FolderOpen size={large ? 28 : 16} /></span>
  return (
    <span ref={ref} className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-md ${large ? 'h-24 w-full' : 'h-9 w-10'} ${image ? 'bg-gradient-to-br from-sky-300 via-indigo-500 to-slate-900' : 'bg-white/[0.06] text-slate-500'}`}>
      {image ? (
        localPath ? (
          <img src={convertFileSrc(localPath)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <ImageIcon size={large ? 30 : 16} className="text-white/80" />
            <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/30 to-transparent" />
          </>
        )
      ) : VIDEO_EXT.test(entry.name) ? (
        <>
          <FileVideo size={large ? 28 : 16} />
          <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/45 p-1"><Play size={9} fill="currentColor" /></span></span>
        </>
      ) : <File size={large ? 28 : 16} />}
    </span>
  )
}

function FileAction({ icon: Icon, label, color, onClick }: { icon: LucideIcon; label: string; color: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 flex-col items-center gap-1 text-[8px] text-slate-400 hover:text-slate-200">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color} transition-transform group-hover:-translate-y-0.5`}><Icon size={14} /></span>
      {label}
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="max-w-[210px] truncate text-right text-slate-300">{value}</dd></div>
}

function EmptyState({ label, loading = false }: { label: string; loading?: boolean }) {
  return <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-slate-500">{loading ? <Loader2 size={24} className="animate-spin text-violet-400" /> : <FolderOpen size={28} className="text-slate-600" />}<span className="text-[10px]">{label}</span></div>
}

function entryType(entry: FileEntry) {
  if (entry.isDir) return 'Folder'
  if (VIDEO_EXT.test(entry.name)) return `${entry.name.split('.').pop()?.toUpperCase() || 'Video'} Video`
  if (isImageFile(entry.name)) return `${entry.name.split('.').pop()?.toUpperCase() || 'Image'} Image`
  return 'File'
}

function mimeType(entry: FileEntry) {
  if (entry.isDir) return 'inode/directory'
  if (VIDEO_EXT.test(entry.name)) return `video/${entry.name.split('.').pop()?.toLowerCase() || 'mp4'}`
  if (isImageFile(entry.name)) return `image/${entry.name.split('.').pop()?.toLowerCase() || 'jpeg'}`
  return 'application/octet-stream'
}

function parentPathSafe(path: string) {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}
