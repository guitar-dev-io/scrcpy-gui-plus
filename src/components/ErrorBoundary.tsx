import React, { ErrorInfo, ReactNode } from 'react'
import { AlertCircle, Download, RefreshCcw } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { I18nContext } from '../i18n'
import { en } from '../i18n/locales/en'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  static contextType = I18nContext
  declare context: React.ContextType<typeof I18nContext>

  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  private translate = (
    key: string,
    vars?: Record<string, string | number | boolean>,
  ): string => {
    if (this.context && typeof this.context.t === 'function') {
      return this.context.t(key, vars)
    }
    // Manual fallback to English when context is unavailable.
    const segments = key.split('.')
    let cursor: unknown = en
    for (const segment of segments) {
      if (
        cursor &&
        typeof cursor === 'object' &&
        segment in (cursor as Record<string, unknown>)
      ) {
        cursor = (cursor as Record<string, unknown>)[segment]
      } else {
        return key
      }
    }
    if (typeof cursor !== 'string') return key
    if (!vars) return cursor
    return cursor.replace(/\{(\w+)\}/g, (m, k) =>
      vars[k] !== undefined ? String(vars[k]) : m,
    )
  }

  private handleExportDiagnostics = async () => {
    const storageData: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) storageData[key] = localStorage.getItem(key) || ''
    }

    const diagnostics = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      localStorage: storageData,
      error: this.state.error?.message || 'Unknown error',
      stack: this.state.error?.stack || 'No stack trace available',
    }

    try {
      const fileName = `scrcpy-gui-plus-diagnostics-${Date.now()}.json`
      await invoke('save_report', {
        content: JSON.stringify(diagnostics, null, 2),
        name: fileName,
      })
      alert(this.translate('errorBoundary.diagnosticSavedAlert', { fileName }))
    } catch (e) {
      console.error('Export failed:', e)
    }
  }

  public render() {
    if (this.state.hasError) {
      const t = this.translate
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6 text-zinc-200 font-sans">
          <div className="max-w-md w-full glass border border-red-500/20 bg-red-500/5 p-8 rounded-3xl space-y-6 text-center shadow-2xl backdrop-blur-xl">
            <div className="inline-flex p-4 bg-red-500/10 rounded-2xl text-red-500 mb-2">
              <AlertCircle size={40} />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-black uppercase tracking-widest text-white">
                {t('errorBoundary.title')}
              </h1>
              <p className="text-sm text-zinc-400 font-medium">
                {t('errorBoundary.subtitle')}
              </p>
            </div>

            <div className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-left overflow-hidden">
              <p className="text-[10px] font-mono text-zinc-500 uppercase mb-2 tracking-tighter">
                {t('errorBoundary.errorSignature')}
              </p>
              <p className="text-[11px] font-mono text-red-400 break-all leading-relaxed">
                {this.state.error?.message ||
                  t('errorBoundary.criticalSystemFailure')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center justify-center gap-2 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
              >
                <RefreshCcw size={14} />
                {t('errorBoundary.reboot')}
              </button>
              <button
                onClick={this.handleExportDiagnostics}
                className="flex items-center justify-center gap-2 py-3 bg-primary text-on-primary rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-primary/20 hover:opacity-90"
              >
                <Download size={14} />
                {t('errorBoundary.exportLogs')}
              </button>
            </div>

            <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">
              {t('errorBoundary.recoveryEngine')}
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
