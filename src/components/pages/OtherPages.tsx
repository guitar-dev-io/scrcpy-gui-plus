import type { ReactNode } from 'react'
import { routeFamilyOf, type AppRouteId } from '../../navigation/appRoutes'
import RouteFamilyTabs from '../app-shell/RouteFamilyTabs'

type OtherPageRoute = Exclude<AppRouteId, 'dashboard'>

interface OtherPagesProps {
  route: OtherPageRoute
  devices: ReactNode
  pairDevice: ReactNode
  deviceWall: ReactNode
  sessions: ReactNode
  screenshots: ReactNode
  recordings: ReactNode
  fileExplorer: ReactNode
  appManager: ReactNode
  apkToolkit: ReactNode
  simulators: ReactNode
  logcatViewer: ReactNode
  inputControl: ReactNode
  qrStudio: ReactNode
  automation: ReactNode
  scriptManager: ReactNode
  taskScheduler: ReactNode
  settings: ReactNode
}

export default function OtherPages({
  route,
  devices,
  pairDevice,
  deviceWall,
  sessions,
  screenshots,
  recordings,
  fileExplorer,
  appManager,
  apkToolkit,
  simulators,
  logcatViewer,
  inputControl,
  qrStudio,
  automation,
  scriptManager,
  taskScheduler,
  settings,
}: OtherPagesProps) {
  const content: Record<OtherPageRoute, ReactNode> = {
    devices,
    'pair-device': pairDevice,
    'device-wall': deviceWall,
    sessions,
    screenshots,
    recordings,
    'file-explorer': fileExplorer,
    'app-manager': appManager,
    'apk-toolkit': apkToolkit,
    simulators,
    'logcat-viewer': logcatViewer,
      'input-control': inputControl,
    'qr-studio': qrStudio,
    automation,
    'script-manager': scriptManager,
    'task-scheduler': taskScheduler,
    settings,
  }

  if (!routeFamilyOf(route)) return <>{content[route]}</>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RouteFamilyTabs route={route} />
      {content[route]}
    </div>
  )
}
