import { useCallback, useEffect, useState } from 'react'
import type { QrRecord } from '../../types/qrStudio'
import type { ToolbarNotifier } from '../device-control-toolbar'
import CreatePanel from '../qr-studio/CreatePanel'
import DeviceActionsPanel from '../qr-studio/DeviceActionsPanel'
import LibraryPanel from '../qr-studio/LibraryPanel'
import type { QrDeviceMeta } from '../qr-studio/QrDeviceCard'
import QrStudioHeader, { panelId, tabId } from '../qr-studio/QrStudioHeader'
import TemplatesPanel from '../qr-studio/TemplatesPanel'
import ToolsPanel from '../qr-studio/ToolsPanel'
import {
  QR_TAB_STORAGE_KEY,
  isQrDestination,
  type QrDestination,
  type QrToolId,
} from '../qr-studio/destinations'
import StoreBanners from '../qr-studio/StoreBanners'
import { useContainerWidth } from '../qr-studio/useContainerWidth'
import { useQrDraft } from '../qr-studio/useQrDraft'
import { useQrStore } from '../qr-studio/useQrStore'

interface QrStudioPageProps {
  /** Kept for API compatibility. The shell sidebar provides navigation, so no Dashboard button renders. */
  onExit?: () => void
  devices: string[]
  deviceLabels?: Record<string, string>
  /** Optional per-serial details (Android version, connection, battery) shown on the device card. */
  deviceMeta?: Record<string, QrDeviceMeta>
  /** `''` when an iOS or companion workspace is active. */
  activeDevice: string
  onSelectDevice: (serial: string) => void
  customPath?: string
  notify: ToolbarNotifier
  /** Starting container width before the first measurement. Mainly for tests. */
  initialWidth?: number
}

function readStoredDestination(): QrDestination {
  try {
    const stored = window.sessionStorage.getItem(QR_TAB_STORAGE_KEY)
    return isQrDestination(stored) ? stored : 'create'
  } catch {
    return 'create'
  }
}

const STATUS_MS = 2400

export default function QrStudioPage({
  devices,
  deviceLabels,
  deviceMeta,
  activeDevice,
  onSelectDevice,
  customPath,
  notify,
  initialWidth,
}: QrStudioPageProps) {
  const store = useQrStore()
  const draftApi = useQrDraft()
  const { ref, width } = useContainerWidth<HTMLDivElement>(initialWidth)
  const [destination, setDestination] = useState<QrDestination>(
    readStoredDestination,
  )
  const [tool, setTool] = useState<QrToolId>('deep-link-builder')
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [status, setStatus] = useState('')

  useEffect(() => {
    try {
      window.sessionStorage.setItem(QR_TAB_STORAGE_KEY, destination)
    } catch {
      // Session storage may be unavailable; the tab just is not remembered.
    }
  }, [destination])

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(''), STATUS_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  const openTool = useCallback((next: QrToolId) => {
    setTool(next)
    setDestination('tools')
  }, [])
  const editRecord = (record: QrRecord) => {
    draftApi.startEdit(record)
    setDestination('create')
  }

  const live = store.state.records.filter((record) => !record.trashedAt)
  const linkCount = live.filter(
    (r) =>
      r.contentType === 'url' ||
      r.contentType === 'deep-link' ||
      r.contentType === 'app-link',
  ).length

  return (
    <div
      ref={ref}
      className="relative flex h-full min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_58%_20%,rgba(255,79,87,.07),transparent_25%)] text-[color:var(--qr-text)] qr-studio-root"
    >
      <QrStudioHeader
        destination={destination}
        onSelectDestination={setDestination}
        containerWidth={width}
        savedCount={live.length}
        linkCount={linkCount}
        devices={devices}
        deviceLabels={deviceLabels}
        deviceMeta={deviceMeta}
        activeDevice={activeDevice}
        onSelectDevice={onSelectDevice}
      />

      <StoreBanners store={store} />

      <div
        role="tabpanel"
        id={panelId(destination)}
        aria-labelledby={tabId(destination)}
        tabIndex={-1}
        className="custom-scrollbar min-h-0 flex-1 overflow-y-auto focus:outline-none"
      >
        {destination === 'create' && (
          <CreatePanel
            store={store}
            draftApi={draftApi}
            containerWidth={width}
            onOpenTool={openTool}
            onOpenDestination={setDestination}
            onStatus={setStatus}
            notify={notify}
            devices={devices}
            deviceLabels={deviceLabels}
            activeDevice={activeDevice}
            customPath={customPath}
          />
        )}
        {destination === 'templates' && (
          <TemplatesPanel
            store={store}
            selection={selection}
            onApplyToCreate={(style) => {
              draftApi.setStyle(style)
              setDestination('create')
            }}
            onStatus={setStatus}
          />
        )}
        {destination === 'device-actions' && (
          <DeviceActionsPanel
            store={store}
            devices={devices}
            deviceLabels={deviceLabels}
            activeDevice={activeDevice}
            customPath={customPath}
            notify={notify}
            draft={draftApi.draft}
            onStatus={setStatus}
          />
        )}
        {destination === 'tools' && (
          <ToolsPanel
            store={store}
            tool={tool}
            onSelectTool={setTool}
            draftApi={draftApi}
            onOpenCreate={() => setDestination('create')}
            onStatus={setStatus}
            devices={devices}
            deviceLabels={deviceLabels}
            activeDevice={activeDevice}
            customPath={customPath}
            notify={notify}
          />
        )}
        {destination === 'library' && (
          <LibraryPanel
            store={store}
            selection={selection}
            onSelectionChange={setSelection}
            onEditRecord={editRecord}
            onStatus={setStatus}
            containerWidth={width}
            devices={devices}
            deviceLabels={deviceLabels}
            activeDevice={activeDevice}
            customPath={customPath}
            notify={notify}
          />
        )}
      </div>

      {/*
        Transient status toast. It lives in a reserved, non-scrolling flex lane
        (shrink-0) after the scroll panel rather than as an absolute overlay, so
        it can never paint over scrollable content such as the "Open on all
        devices" broadcast button in the Device Actions panel. The lane keeps a
        fixed height whether or not a message is showing, so toasts appear and
        clear without shifting the layout. Placement (bottom-centered), the
        role/aria-live announcement and the auto-clear timer are unchanged.
      */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none flex h-12 shrink-0 items-center justify-center px-4"
      >
        {status && (
          <p className="rounded-lg border border-[#2a3749] bg-[#0d1725] px-4 py-2 text-[11px] text-slate-100 shadow-lg">
            {status}
          </p>
        )}
      </div>
    </div>
  )
}
