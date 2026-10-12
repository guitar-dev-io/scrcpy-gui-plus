import { redactWifi } from '../../services/qrStudioStore'
import { classNames } from '../ui/classNames'
import QrThumb from './QrThumb'
import {
  Chip,
  FavoriteButton,
  QuickActions,
  RecordMenu,
  SelectCheckbox,
  isInteractiveTarget,
  type RecordViewProps,
} from './RecordParts'
import { relativeDate, typeBadgeClass, typeLabel } from './libraryUtils'

/** Dense list row. The list row is 56px; the row is 4px shorter to leave a gap. */
export default function QrRow(props: RecordViewProps) {
  const { record, folderName, tagNames, selected, active, inTrash, actions, onToggleSelect } = props
  return (
    <article
      aria-label={record.name}
      aria-current={active ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      onClick={(event) => {
        if (!isInteractiveTarget(event)) actions.open(record)
      }}
      className={classNames(
        'flex h-[52px] min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-lg border bg-[#101b2a] px-3 transition hover:border-[#ff4f57]/40',
        active ? 'border-[#ff4f57] ring-1 ring-[#ff4f57]/60' : 'border-[#293649]',
        selected && 'bg-[#1a2535]',
      )}
    >
      <SelectCheckbox record={record} selected={selected} onToggleSelect={onToggleSelect} />
      <QrThumb record={record} size={38} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => actions.open(record)}
          className="block max-w-full truncate text-left text-[12px] font-semibold text-[color:var(--qr-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60"
        >
          {record.name}
        </button>
        <p className="truncate font-mono text-[10px] text-slate-500" title={redactWifi(record.content)}>
          {redactWifi(record.content)}
        </p>
      </div>
      <span className={classNames('hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex', typeBadgeClass(record.contentType))}>
        {typeLabel(record.contentType)}
      </span>
      <div className="hidden min-w-0 shrink items-center gap-1 overflow-hidden lg:flex">
        {folderName && <Chip title="Folder">{folderName}</Chip>}
        {tagNames.slice(0, 2).map((name) => (
          <Chip key={name} title="Tag">{`#${name}`}</Chip>
        ))}
      </div>
      <p className="hidden w-28 shrink-0 truncate text-[10px] text-slate-500 md:block">{relativeDate(record.updatedAt)}</p>
      <div className="flex shrink-0 items-center">
        <FavoriteButton record={record} actions={actions} />
        {!inTrash && <QuickActions record={record} actions={actions} />}
        <RecordMenu record={record} inTrash={inTrash} actions={actions} />
      </div>
    </article>
  )
}
