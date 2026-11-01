import { useMemo, useState } from 'react'
import { Bug, ClipboardCopy, FileArchive, FolderOpen, ScrollText, Settings2, Smartphone, Trash2 } from 'lucide-react'
import type { ToolbarNotifier } from '../device-control-toolbar'
import type { CrashWatcherController } from '../../hooks/useCrashWatcher'
import { useI18n } from '../../i18n'
import { Badge, Button, Panel, SectionHeader } from '../ui'
import type { BadgeTone } from '../ui'
import { classNames } from '../ui/classNames'
import {
  crashSubject,
  formatCrashText,
  matchesPackageFilter,
  parsePackageFilter,
  type CrashKind,
  type CrashRecord,
} from '../../types/crashWatcher'

export interface CrashWatcherPanelProps {
  controller: CrashWatcherController
  /** Online Android serials. */
  devices: readonly string[]
  deviceLabels?: Record<string, string>
  outputDir: string
  notify: ToolbarNotifier
  confirmAction?: (title: string, message: string, onConfirm: () => void) => void
  onOpenLogcat?: (serial: string, packageName: string) => void
  onRevealPath?: (path: string) => void
}

type KindFilter = 'all' | CrashKind

const KIND_TONE: Record<CrashKind, BadgeTone> = {
  crash: 'danger',
  native_crash: 'danger',
  anr: 'warning',
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function CrashWatcherPanel({
  controller,
  devices,
  deviceLabels = {},
  outputDir,
  notify,
  confirmAction,
  onOpenLogcat,
  onRevealPath,
}: CrashWatcherPanelProps) {
  const { t } = useI18n()
  const { watched, running, errors, history, settings, setWatched, updateSettings, createReport, removeRecord, clearHistory } =
    controller
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [showOtherApps, setShowOtherApps] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const filters = useMemo(() => parsePackageFilter(settings.packageFilter), [settings.packageFilter])
  const deviceRows = useMemo(
    () => Array.from(new Set([...devices, ...watched])),
    [devices, watched],
  )
  const online = useMemo(() => new Set(devices), [devices])

  const visible = history.filter(
    (record) =>
      (kindFilter === 'all' || record.kind === kindFilter) &&
      (showOtherApps || matchesPackageFilter(record, filters)),
  )
  const hiddenOther = filters.length > 0 && !showOtherApps
    ? history.filter((record) => !matchesPackageFilter(record, filters)).length
    : 0

  const label = (serial: string) => deviceLabels[serial] ?? serial

  const deviceStatus = (serial: string): { tone: BadgeTone; text: string } => {
    if (!watched.includes(serial)) return { tone: 'neutral', text: t('crashWatcher.devices.off') }
    if (!online.has(serial)) return { tone: 'neutral', text: t('crashWatcher.devices.offline') }
    if (running[serial]) return { tone: 'success', text: t('crashWatcher.devices.watching') }
    if (errors[serial]) return { tone: 'danger', text: t('crashWatcher.devices.error') }
    return { tone: 'accent', text: t('crashWatcher.devices.starting') }
  }

  const copy = async (record: CrashRecord) => {
    const ok = await copyText(formatCrashText(record, deviceLabels[record.serial]))
    notify(
      ok ? t('crashWatcher.history.copied') : t('crashWatcher.history.copyFailed'),
      crashSubject(record),
      ok ? 'success' : 'error',
    )
  }

  const confirmClear = () => {
    if (confirmAction) confirmAction(t('crashWatcher.history.clear'), t('crashWatcher.history.clearConfirm'), clearHistory)
    else clearHistory()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="flex flex-col gap-3" role="region" aria-label={t('crashWatcher.devices.title')}>
          <SectionHeader
            title={t('crashWatcher.devices.title')}
            description={t('crashWatcher.devices.description')}
            icon={<Smartphone size={14} aria-hidden="true" />}
          />
          {deviceRows.length === 0 ? (
            <p className="text-[var(--font-size-body-sm)] text-[var(--text-subtle)]">{t('crashWatcher.devices.none')}</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {deviceRows.map((serial) => {
                const status = deviceStatus(serial)
                const isWatched = watched.includes(serial)
                return (
                  <li key={serial} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[var(--font-size-body-sm)] font-semibold text-[var(--text-base)]">
                        {label(serial)}
                      </div>
                      <div className="truncate text-[var(--font-size-caption)] text-[var(--text-subtle)]">
                        {serial}
                        {isWatched && errors[serial] ? ` · ${errors[serial]}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={status.tone}>{status.text}</Badge>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isWatched}
                        aria-label={t('crashWatcher.devices.toggle', { device: label(serial) })}
                        onClick={() => setWatched(serial, !isWatched)}
                        className={classNames(
                          'relative h-6 w-11 rounded-full border transition-colors',
                          isWatched ? 'border-primary/60 bg-primary/70' : 'border-[var(--border-base)] bg-[var(--bg-input)]',
                        )}
                      >
                        <span
                          className={classNames(
                            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]',
                            isWatched ? 'left-[22px]' : 'left-0.5',
                          )}
                        />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel className="flex flex-col gap-3" role="region" aria-label={t('crashWatcher.settings.title')}>
          <SectionHeader
            title={t('crashWatcher.settings.title')}
            description={t('crashWatcher.settings.description')}
            icon={<Settings2 size={14} aria-hidden="true" />}
          />
          <label className="flex flex-col gap-1 text-[var(--font-size-label)] font-semibold text-[var(--text-muted)]">
            {t('crashWatcher.settings.packages')}
            <input
              type="text"
              value={settings.packageFilter}
              onChange={(event) => updateSettings({ packageFilter: event.target.value })}
              placeholder="com.example.app, com.example.*"
              className="h-9 rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-input)] px-2 font-normal text-[var(--text-base)]"
            />
            <span className="font-normal text-[var(--text-subtle)]">{t('crashWatcher.settings.packagesHint')}</span>
          </label>
          <label className="flex items-center gap-2 text-[var(--font-size-body-sm)] text-[var(--text-base)]">
            <input
              type="checkbox"
              checked={settings.notify}
              onChange={(event) => updateSettings({ notify: event.target.checked })}
            />
            {t('crashWatcher.settings.notify')}
          </label>
          <label className="flex items-start gap-2 text-[var(--font-size-body-sm)] text-[var(--text-base)]">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.autoReport}
              onChange={(event) => updateSettings({ autoReport: event.target.checked })}
            />
            <span>
              {t('crashWatcher.settings.autoReport')}
              <span className="block text-[var(--font-size-caption)] text-[var(--text-subtle)]">
                {t('crashWatcher.settings.autoReportHint', { dir: outputDir || '…' })}
              </span>
            </span>
          </label>
        </Panel>
      </div>

      <Panel className="flex flex-col gap-3" role="region" aria-label={t('crashWatcher.history.title')}>
        <SectionHeader
          title={t('crashWatcher.history.title')}
          description={t('crashWatcher.history.description')}
          icon={<Bug size={14} aria-hidden="true" />}
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={history.length === 0}
              onClick={confirmClear}
              leadingIcon={<Trash2 size={13} aria-hidden="true" />}
            >
              {t('crashWatcher.history.clear')}
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'crash', 'native_crash', 'anr'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={kindFilter === kind}
              onClick={() => setKindFilter(kind)}
              className={classNames(
                'min-h-7 rounded-[var(--radius-control)] border px-2.5 text-[var(--font-size-label)] font-bold',
                kindFilter === kind
                  ? 'border-primary/60 bg-primary/15 text-primary'
                  : 'border-[var(--border-base)] bg-[var(--bg-input)] text-[var(--text-muted)]',
              )}
            >
              {t(`crashWatcher.kind.${kind}`)}
            </button>
          ))}
          {filters.length > 0 && (
            <label className="ml-auto flex items-center gap-2 text-[var(--font-size-label)] text-[var(--text-muted)]">
              <input type="checkbox" checked={showOtherApps} onChange={(event) => setShowOtherApps(event.target.checked)} />
              {t('crashWatcher.history.showOther', { count: hiddenOther })}
            </label>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="py-6 text-center text-[var(--font-size-body-sm)] text-[var(--text-subtle)]">
            {history.length === 0 ? t('crashWatcher.history.empty') : t('crashWatcher.history.noneMatch')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((record) => {
              const open = expanded === record.id
              const report = record.report
              return (
                <li
                  key={record.id}
                  className="rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-input)]"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : record.id)}
                    className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
                  >
                    <Badge tone={KIND_TONE[record.kind]}>{t(`crashWatcher.kind.${record.kind}`)}</Badge>
                    <span className="font-semibold text-[var(--text-base)]">{crashSubject(record)}</span>
                    <span className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">
                      {label(record.serial)} · {record.time}
                    </span>
                    <span className="w-full truncate text-[var(--font-size-label)] text-[var(--text-muted)]">
                      {record.summary}
                    </span>
                  </button>
                  {open && (
                    <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]">
                        {record.lines.join('\n')}
                        {record.truncated ? `\n${t('crashWatcher.history.truncated')}` : ''}
                      </pre>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void copy(record)}
                          leadingIcon={<ClipboardCopy size={13} aria-hidden="true" />}
                        >
                          {t('crashWatcher.history.copy')}
                        </Button>
                        {report.status === 'saved' && onRevealPath ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onRevealPath(report.zipPath)}
                            leadingIcon={<FolderOpen size={13} aria-hidden="true" />}
                          >
                            {t('crashWatcher.history.showReport')}
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={report.status === 'creating'}
                            onClick={() => void createReport(record.id)}
                            leadingIcon={<FileArchive size={13} aria-hidden="true" />}
                          >
                            {report.status === 'creating'
                              ? t('crashWatcher.history.creating')
                              : t('crashWatcher.history.createReport')}
                          </Button>
                        )}
                        {record.package && onOpenLogcat && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenLogcat(record.serial, record.package as string)}
                            leadingIcon={<ScrollText size={13} aria-hidden="true" />}
                          >
                            {t('crashWatcher.history.openLogcat')}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => removeRecord(record.id)}>
                          {t('crashWatcher.history.remove')}
                        </Button>
                      </div>
                      {report.status === 'failed' && (
                        <p role="alert" className="text-[var(--font-size-caption)] text-red-400">
                          {t('crashWatcher.history.reportFailed', { error: report.error })}
                        </p>
                      )}
                      {report.status === 'saved' && (
                        <p className="break-all text-[var(--font-size-caption)] text-[var(--text-subtle)]">
                          {report.zipPath}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
