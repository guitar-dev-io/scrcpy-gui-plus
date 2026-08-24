import AppManager from '../app-manager'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface AppManagerPageProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  confirmAction: (title: string, message: string, onConfirm: () => void) => void
  onInstallApk: () => void
  onInstallMultiple?: () => void
  onOpenLogcat: (packageName: string) => void
  onOpenShell: (packageName: string) => void
  onPullApk: (packageName: string, remotePath: string) => Promise<void> | void
}

export default function AppManagerPage({ activeDevice, customPath, notify, confirmAction, onInstallApk, onInstallMultiple, onOpenLogcat, onOpenShell, onPullApk }: AppManagerPageProps) {
  return <div className="flex min-h-0 flex-1 flex-col px-4 pb-5 lg:px-6"><AppManager embedded isOpen={false} onClose={() => undefined} activeDevice={activeDevice} customPath={customPath} notify={notify} confirmAction={confirmAction} onInstallApk={onInstallApk} onInstallMultiple={onInstallMultiple} onOpenLogcat={onOpenLogcat} onOpenShell={onOpenShell} onPullApk={onPullApk} /></div>
}
