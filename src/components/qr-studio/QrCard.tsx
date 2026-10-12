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

/** Grid card. The grid row is 232px; the card is 12px shorter to leave a gap. */
export default function QrCard(props: RecordViewProps) {
  const { record, folderName, tagNames, selected, active, inTrash, actions, onToggleSelect } = props
  const shownTags = tagNames.slice(0, 2)
  return (
    <article
      aria-label={record.name}
      aria-current={active ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      onClick={(event) => {
        if (!isInteractiveTarget(event)) actions.open(record)
      }}
      className={classNames(
        'relative flex h-[220px] min-w-0 cursor-pointer flex-col gap-1.5 overflow-hidden rounded-xl border bg-[#101b2a] p-3 transition hover:border-[#ff4f57]/40',
        active ? 'border-[#ff4f57] ring-1 ring-[#ff4f57]/60' : 'border-[#293649]',
        selected && 'bg-[#1a2535]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <SelectCheckbox record={record} selected={selected} onToggleSelect={onToggleSelect} />
        <QrThumb record={record} size={80} />
        <FavoriteButton record={record} actions={actions} />
      </div>
      <button
        type="button"
        onClick={() => actions.open(record)}
        className="truncate text-left text-[12px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60"
      >
        {record.name}
      </button>
      <p className="truncate font-mono text-[10px] text-slate-500" title={redactWifi(record.content)}>
        {redactWifi(record.content)}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
        <span className={classNames('inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium', typeBadgeClass(record.contentType))}>
          {typeLabel(record.contentType)}
        </span>
        {folderName && <Chip title="Folder">{folderName}</Chip>}
        {shownTags.map((name) => (
          <Chip key={name} title="Tag">{`#${name}`}</Chip>
        ))}
        {tagNames.length > shownTags.length && <Chip>{`+${tagNames.length - shownTags.length}`}</Chip>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-1">
        <p className="min-w-0 truncate text-[10px] text-slate-500">{relativeDate(record.updatedAt)}</p>
        <div className="flex shrink-0 items-center">
          {!inTrash && <QuickActions record={record} actions={actions} />}
          <RecordMenu record={record} inTrash={inTrash} actions={actions} />
        </div>
      </div>
    </article>
  )
}
