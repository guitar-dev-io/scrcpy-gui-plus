import type { ReactNode } from 'react'
import type { AppRouteId } from '../../navigation/appRoutes'

type OtherPageRoute = Exclude<AppRouteId, 'dashboard'>

interface OtherPagesProps {
  route: OtherPageRoute
  devices: ReactNode
  sessions: ReactNode
  screenshots: ReactNode
  recordings: ReactNode
  fileExplorer: ReactNode
  wirelessAdb: ReactNode
  appManager: ReactNode
  logcatViewer: ReactNode
  performance: ReactNode
  inputControl: ReactNode
  automation: ReactNode
  scriptManager: ReactNode
  taskScheduler: ReactNode
  settings: ReactNode
}

export default function OtherPages({
  route,
  devices,
  sessions,
  screenshots,
  recordings,
  fileExplorer,
  wirelessAdb,
  appManager,
  logcatViewer,
  performance,
  inputControl,
  automation,
  scriptManager,
  taskScheduler,
  settings,
}: OtherPagesProps) {
  const content: Record<OtherPageRoute, ReactNode> = {
    devices,
    sessions,
    screenshots,
    recordings,
    'file-explorer': fileExplorer,
    'wireless-adb': wirelessAdb,
    'app-manager': appManager,
    'logcat-viewer': logcatViewer,
    performance,
    'input-control': inputControl,
    automation,
    'script-manager': scriptManager,
    'task-scheduler': taskScheduler,
    settings,
  }

  return <>{content[route]}</>
}
