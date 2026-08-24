import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Download,
  ExternalLink,
  FolderOpen,
  HelpCircle,
  Moon,
  Palette,
  RefreshCcw,
  Settings,
  Smartphone,
  Sun,
  Monitor,
  Maximize2,
  BatteryMedium,
  Command,
  Wifi,
  UserCircle,
  X,
} from 'lucide-react'
import { SUPPORTED_LOCALES, useI18n, type Locale } from '../i18n'
import { useDeviceStatus } from '../hooks/useDeviceStatus'

interface HeaderProps {
  compact?: boolean
  onThemeChange: (theme: string) => void
  currentTheme: string
  colorMode: 'light' | 'dark' | 'system'
  onColorModeChange: (mode: 'light' | 'dark' | 'system') => void
  binaryStatus: { found: boolean; message: string }
  activeDevice: string
  customPath?: string
  connected: boolean
  isRefreshing: boolean
  onRefresh: () => void
  onOpenSettings: () => void
  onOpenCommandPalette?: () => void
  onDownload: () => void
  onSetPath: () => void
  onResetPath: () => void
  isDownloading: boolean
  downloadProgress: number
  version: string
}

const THEMES = [
  { id: 'ultraviolet', color: '#7c4dff' },
  { id: 'astro', color: '#3b82f6' },
  { id: 'carbon', color: '#ffffff' },
  { id: 'emerald', color: '#10b981' },
  { id: 'bloodmoon', color: '#ef4444' },
] as const

export default function Header({
  compact = false,
  onThemeChange,
  currentTheme,
  colorMode,
  onColorModeChange,
  binaryStatus,
  activeDevice,
  customPath,
  connected,
  isRefreshing,
  onRefresh,
  onOpenSettings,
  onOpenCommandPalette,
  onDownload,
  onSetPath,
  onResetPath,
  isDownloading,
  downloadProgress,
  version,
}: HeaderProps) {
  const { t, locale, setLocale, translations } = useI18n()
  const [showHelp, setShowHelp] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)
  const [showLangMenu, setShowLangMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { status: deviceStatus } = useDeviceStatus({
    activeDevice,
    customPath,
    autoRefresh: false,
    enabled: !!activeDevice,
  })

  useEffect(() => {
    if (!showAppearance && !showLangMenu) return
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAppearance(false)
        setShowLangMenu(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [showAppearance, showLangMenu])

  useEffect(() => {
    if (!showAppearance && !showLangMenu && !showHelp) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setShowAppearance(false)
      setShowLangMenu(false)
      setShowHelp(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showAppearance, showHelp, showLangMenu])

  const iconButton =
    'flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'

  return (
    <>
      <header className={`flex items-stretch ${compact ? 'h-10 gap-0' : 'h-[58px] gap-4'}`}>
        <section className={`${compact ? 'hidden' : 'flex'} min-w-0 flex-1 items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 shadow-[var(--shadow-sm)]`}>
          <Smartphone size={20} className="shrink-0 text-[var(--text-muted)]" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[12px] font-semibold text-[var(--text-base)]">
                {deviceStatus?.model || activeDevice || 'No Android device selected'}
              </h1>
              <span className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${activeDevice ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--bg-hover)] text-[var(--text-subtle)]'}`}>
                {activeDevice ? 'Online' : 'Offline'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-[var(--text-subtle)]">
              {activeDevice
                ? [activeDevice, deviceStatus?.androidVersion && `Android ${deviceStatus.androidVersion}`].filter(Boolean).join(' · ')
                : 'Connect a device to begin'}
            </p>
          </div>
          <div className="ml-auto hidden items-center gap-5 text-[10px] text-[var(--text-subtle)] md:flex">
            <span className="flex items-center gap-1.5"><Maximize2 size={13} /> {deviceStatus?.resolution || (connected ? 'Session active' : 'Ready')}</span>
            <span className="flex items-center gap-1.5"><BatteryMedium size={13} /> {deviceStatus?.batteryLevel !== undefined ? `${deviceStatus.batteryLevel}%` : '—'}</span>
            <Wifi size={13} />
          </div>
        </section>

        <div ref={menuRef} className={`relative flex min-w-0 items-center px-2 ${compact ? 'bg-transparent sm:min-w-0' : 'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] sm:min-w-[340px] sm:px-4'}`}>
          <div className={`${compact ? 'mr-2 hidden xl:block' : 'mr-auto'} min-w-0`}>
            <div className="flex items-center gap-2">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Scrcpy Engine</p>
              <span className={`h-1.5 w-1.5 rounded-full ${binaryStatus.found ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            </div>
            <p className={`mt-0.5 max-w-32 truncate text-[9px] font-semibold uppercase ${binaryStatus.found ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isDownloading ? `${downloadProgress}%` : binaryStatus.found ? t('header.scrcpyReady') : binaryStatus.message}
            </p>
          </div>
          {!binaryStatus.found && !isDownloading && (
            <button
              type="button"
              onClick={onDownload}
              className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-primary px-3 text-[var(--font-size-caption)] font-semibold text-on-primary hover:bg-[var(--primary-hover)]"
            >
              <Download size={13} /> {t('header.installCore')}
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className={iconButton}
            title={t('sidebar.refresh')}
            aria-label={t('sidebar.refresh')}
          >
            <RefreshCcw size={15} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onSetPath}
            className={iconButton}
            title={t('header.selectFolder')}
            aria-label={t('header.selectFolder')}
          >
            <FolderOpen size={15} />
          </button>
          <button
            type="button"
            onClick={() => { setShowAppearance((open) => !open); setShowLangMenu(false) }}
            className={iconButton}
            title={t('header.themeLabel')}
            aria-label={t('header.themeLabel')}
            aria-expanded={showAppearance}
            aria-controls="appearance-menu"
            aria-haspopup="dialog"
          >
            <Palette size={15} />
          </button>
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className={iconButton}
            title="Command palette (Cmd/Ctrl+K)"
            aria-label="Open command palette"
          >
            <Command size={15} />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className={iconButton}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={15} />
          </button>
          <button type="button" onClick={() => setShowHelp(true)} className={iconButton} title={t('header.setupHelpTitle')} aria-label={t('header.setupHelpTitle')} aria-expanded={showHelp} aria-controls="setup-help-dialog" aria-haspopup="dialog">
            <HelpCircle size={15} />
          </button>
          <button type="button" onClick={() => { setShowLangMenu((open) => !open); setShowAppearance(false) }} className={iconButton} title={`${t('header.languageLabel')} · v${version}`} aria-label={`${t('header.languageLabel')} · v${version}`} aria-expanded={showLangMenu} aria-controls="language-menu" aria-haspopup="menu">
            <UserCircle size={19} />
          </button>

          {showAppearance && (
            <div id="appearance-menu" role="dialog" aria-label={t('header.themeLabel')} className="absolute right-0 top-10 z-[120] w-64 rounded-[var(--radius-lg)] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]">
              <p className="mb-2 text-[var(--font-size-caption)] font-semibold text-[var(--text-muted)]">
                Accent color
              </p>
              <div className="flex gap-2">
                {THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => onThemeChange(theme.id)}
                    className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                      currentTheme === theme.id
                        ? 'border-[var(--text-base)]'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: theme.color }}
                    title={t(`header.themes.${theme.id}`)}
                    aria-label={t(`header.themes.${theme.id}`)}
                    aria-pressed={currentTheme === theme.id}
                  />
                ))}
              </div>
              <p className="mb-2 mt-4 text-[var(--font-size-caption)] font-semibold text-[var(--text-muted)]">
                Appearance
              </p>
              <div className="grid grid-cols-3 gap-1">
                {([
                  ['light', Sun],
                  ['dark', Moon],
                  ['system', Monitor],
                ] as const).map(([mode, Icon]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onColorModeChange(mode)}
                    aria-pressed={colorMode === mode}
                    className={`flex items-center justify-center gap-1 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--font-size-caption)] capitalize ${
                      colorMode === mode
                        ? 'bg-primary text-on-primary'
                        : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-base)]'
                    }`}
                  >
                    <Icon size={12} /> {mode}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                <button type="button" onClick={onSetPath} className={iconButton} title={t('header.selectFolder')} aria-label={t('header.selectFolder')}>
                  <FolderOpen size={14} />
                </button>
                <button type="button" onClick={onResetPath} className={iconButton} title={t('header.resetPath')} aria-label={t('header.resetPath')}>
                  <RefreshCcw size={14} />
                </button>
                <span className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">
                  Engine path
                </span>
              </div>
            </div>
          )}

          {showLangMenu && (
            <div id="language-menu" role="menu" aria-label={t('header.languageLabel')} className="absolute right-0 top-10 z-[120] min-w-44 rounded-[var(--radius-lg)] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]">
              {SUPPORTED_LOCALES.map((nextLocale: Locale) => (
                <button
                  key={nextLocale}
                  type="button"
                  onClick={() => {
                    setLocale(nextLocale)
                    setShowLangMenu(false)
                  }}
                  role="menuitemradio"
                  aria-checked={nextLocale === locale}
                  className={`flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-left text-[var(--font-size-body-sm)] ${
                    nextLocale === locale
                      ? 'bg-primary/15 text-primary'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]'
                  }`}
                >
                  {translations.languages[nextLocale]}
                  {nextLocale === locale && <ChevronDown size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {showHelp && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div id="setup-help-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-help-title" className="w-full max-w-md rounded-[var(--radius-2xl)] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-lg)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="setup-help-title" className="flex items-center gap-2 text-[var(--font-size-title)] font-semibold">
                <HelpCircle size={18} className="text-primary" />
                {t('header.manualSetupGuide')}
              </h2>
              <button type="button" onClick={() => setShowHelp(false)} className={iconButton} aria-label="Close setup help">
                <X size={17} />
              </button>
            </div>
            <div className="space-y-4 text-[var(--font-size-body-sm)] leading-6 text-[var(--text-muted)]">
              <p>{t('header.manualSetupIntro')}</p>
              <ol className="list-inside list-decimal space-y-2">
                <li>
                  {t('header.manualStep1')}{' '}
                  <a
                    href="https://github.com/Genymobile/scrcpy/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {t('header.manualStep1Link')} <ExternalLink size={11} />
                  </a>
                </li>
                <li>{t('header.manualStep2')}</li>
                <li>{t('header.manualStep3Before')} {t('header.manualStep3Browse')} {t('header.manualStep3After')}</li>
                <li>{t('header.manualStep4Before')} {t('header.manualStep4Executable')} {t('header.manualStep4After')}</li>
              </ol>
              <p className="border-t border-[var(--border-subtle)] pt-3 text-[var(--text-subtle)]">
                {t('header.manualNote')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="mt-6 h-10 w-full rounded-[var(--radius-md)] bg-primary text-[var(--font-size-body-sm)] font-semibold text-on-primary hover:bg-[var(--primary-hover)]"
            >
              {t('header.gotIt')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
