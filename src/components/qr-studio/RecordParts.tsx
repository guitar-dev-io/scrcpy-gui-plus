import { Copy, Download, Eye, FileCode2, FolderInput, MoreHorizontal, Pencil, CopyPlus, RotateCcw, Send, Smartphone, Star, Trash2, XCircle } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { QrRecord } from '../../types/qrStudio'
import { Menu, Tooltip } from '../ui'
import type { MenuItem } from '../ui'
import { classNames } from '../ui/classNames'
import type { ActionState } from './useDeviceActions'

export interface RecordActions {
  open: (record: QrRecord) => void
  edit: (record: QrRecord) => void
  duplicate: (record: QrRecord) => void
  move: (ids: string[]) => void
  downloadPng: (record: QrRecord) => void
  downloadSvg: (record: QrRecord) => void
  copy: (record: QrRecord) => void
  toggleFavorite: (id: string) => void
  trash: (ids: string[]) => void
  restore: (ids: string[]) => void
  deleteForever: (ids: string[]) => void
  /** Open on Device. Records that were not authored in Create ask for confirmation first. */
  openOnDevice: (record: QrRecord) => void
  sendToDevice: (record: QrRecord) => void
  /** Null when the device action can run for `record`, otherwise the visible reason it cannot. */
  deviceReason: (record: QrRecord, action: 'open' | 'send') => string | null
  deviceState: (action: 'open' | 'send') => ActionState
}

export interface RecordViewProps {
  record: QrRecord
  folderName?: string
  tagNames: string[]
  selected: boolean
  active: boolean
  inTrash: boolean
  actions: RecordActions
  onToggleSelect: (id: string, shiftKey: boolean) => void
}

export const iconButtonClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-400 transition hover:border-[#ff4f57]/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60 disabled:opacity-40'

/** True when a click came from an interactive child, so the surrounding card should not open details. */
export function isInteractiveTarget(event: MouseEvent): boolean {
  return (event.target as HTMLElement).closest('button, input, a, select, textarea, [role="menu"]') !== null
}

export function SelectCheckbox({
  record,
  selected,
  onToggleSelect,
  className,
}: Pick<RecordViewProps, 'record' | 'selected' | 'onToggleSelect'> & { className?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={`Select ${record.name}`}
      checked={selected}
      onChange={() => undefined}
      onClick={(event) => onToggleSelect(record.id, event.shiftKey)}
      className={classNames('h-4 w-4 shrink-0 cursor-pointer accent-[#ff4f57]', className)}
    />
  )
}

export function FavoriteButton({ record, actions }: Pick<RecordViewProps, 'record' | 'actions'>) {
  const on = Boolean(record.favorite)
  return (
    <button
      type="button"
      aria-label="Favorite"
      aria-pressed={on}
      title={on ? 'Remove from favorites' : 'Add to favorites'}
      className={classNames(iconButtonClass, on && 'text-amber-300')}
      onClick={() => actions.toggleFavorite(record.id)}
    >
      <Star size={14} aria-hidden="true" fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

export function QuickActions({ record, actions }: Pick<RecordViewProps, 'record' | 'actions'>) {
  return (
    <>
      <Tooltip content="Download PNG">
        <button type="button" aria-label="Download PNG" className={iconButtonClass} onClick={() => actions.downloadPng(record)}>
          <Download size={14} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content="Copy">
        <button type="button" aria-label="Copy" className={iconButtonClass} onClick={() => actions.copy(record)}>
          <Copy size={14} aria-hidden="true" />
        </button>
      </Tooltip>
    </>
  )
}

export function RecordMenu({ record, inTrash, actions }: Pick<RecordViewProps, 'record' | 'inTrash' | 'actions'>) {
  const icon = (node: typeof Eye) => {
    const Icon = node
    return <Icon size={13} aria-hidden="true" />
  }
  const items: MenuItem[] = inTrash
    ? [
        { id: 'preview', label: 'Preview', icon: icon(Eye), onSelect: () => actions.open(record) },
        { id: 'restore', label: 'Restore', icon: icon(RotateCcw), onSelect: () => actions.restore([record.id]) },
        {
          id: 'delete-forever',
          label: 'Delete forever',
          icon: icon(XCircle),
          danger: true,
          separatorBefore: true,
          onSelect: () => actions.deleteForever([record.id]),
        },
      ]
    : [
        { id: 'preview', label: 'Preview', icon: icon(Eye), onSelect: () => actions.open(record) },
        { id: 'edit', label: 'Edit', icon: icon(Pencil), onSelect: () => actions.edit(record) },
        { id: 'duplicate', label: 'Duplicate', icon: icon(CopyPlus), onSelect: () => actions.duplicate(record) },
        { id: 'move', label: 'Move to…', icon: icon(FolderInput), onSelect: () => actions.move([record.id]) },
        { id: 'svg', label: 'Download SVG', icon: icon(FileCode2), onSelect: () => actions.downloadSvg(record) },
        {
          id: 'open-device',
          label: 'Open on device',
          icon: icon(Smartphone),
          separatorBefore: true,
          disabled: actions.deviceReason(record, 'open') !== null,
          onSelect: () => actions.openOnDevice(record),
        },
        {
          id: 'send-device',
          label: 'Send to device',
          icon: icon(Send),
          disabled: actions.deviceReason(record, 'send') !== null,
          onSelect: () => actions.sendToDevice(record),
        },
        {
          id: 'delete',
          label: 'Delete',
          icon: icon(Trash2),
          danger: true,
          separatorBefore: true,
          onSelect: () => actions.trash([record.id]),
        },
      ]
  return (
    <Menu
      items={items}
      triggerLabel={`Actions for ${record.name}`}
      trigger={<MoreHorizontal size={15} aria-hidden="true" />}
      triggerClassName={iconButtonClass}
      placement="bottom-end"
    />
  )
}

export function Chip({ children, title }: { children: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-[110px] items-center truncate rounded-md border border-[#2a3749] bg-[#0d1725] px-1.5 py-0.5 text-[10px] text-slate-300"
    >
      {children}
    </span>
  )
}
