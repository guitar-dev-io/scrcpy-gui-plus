import { useEffect, useRef, useState } from 'react'
import {
  Download,
  FolderOpen,
  RefreshCcw,
  Palette,
  HelpCircle,
  X,
  ExternalLink,
  Languages,
  ChevronDown,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react'
import { SUPPORTED_LOCALES, useI18n, type Locale } from '../i18n'

interface HeaderProps {
  onThemeChange: (theme: string) => void
  currentTheme: string
  colorMode: 'light' | 'dark' | 'system'
  onColorModeChange: (mode: 'light' | 'dark' | 'system') => void
  binaryStatus: { found: boolean; message: string }
  onDownload: () => void
  onSetPath: () => void
  onResetPath: () => void
  isDownloading: boolean
  downloadProgress: number
  version: string
}

export default function Header({
  onThemeChange,
  currentTheme,
  colorMode,
  onColorModeChange,
  binaryStatus,
  onDownload,
  onSetPath,
  onResetPath,
  isDownloading,
  downloadProgress,
  version,
}: HeaderProps) {
  const { t, locale, setLocale, translations } = useI18n()
  const [showHelp, setShowHelp] = useState(false)
  const [showLangMenu, setShowLangMenu] = useState(false)
  const langMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showLangMenu) return
    const onClick = (event: MouseEvent) => {
      if (
        langMenuRef.current &&
        !langMenuRef.current.contains(event.target as Node)
      ) {
        setShowLangMenu(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [showLangMenu])

  return (
    <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-2 py-4">
      {showHelp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass max-w-md w-full p-6 rounded-2xl border border-zinc-800 shadow-2xl animate-in fade-in zoom-in-95 duration-200 bg-zinc-950/90">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <HelpCircle size={18} /> {t('header.manualSetupGuide')}
              </h3>
              <button
                onClick={() => setShowHelp(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs leading-relaxed text-zinc-300">
              <p>{t('header.manualSetupIntro')}</p>

              <ol className="list-decimal list-inside space-y-3 font-medium">
                <li>
                  {t('header.manualStep1')}
                  <a
                    href="https://github.com/Genymobile/scrcpy/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 mt-1 ml-4"
                  >
                    {t('header.manualStep1Link')} <ExternalLink size={10} />
                  </a>
                </li>
                <li>{t('header.manualStep2')}</li>
                <li>
                  {t('header.manualStep3Before')}{' '}
                  <span className="text-white font-bold inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-800 rounded border border-zinc-700 shadow-sm mx-1">
                    <FolderOpen size={10} /> {t('header.manualStep3Browse')}
                  </span>{' '}
                  {t('header.manualStep3After')}
                </li>
                <li>
                  {t('header.manualStep4Before')}{' '}
                  <code className="text-primary font-bold">
                    {t('header.manualStep4Executable')}
                  </code>{' '}
                  {t('header.manualStep4After')}
                </li>
              </ol>

              <div className="pt-3 border-t border-zinc-800/50">
                <p className="text-zinc-500 italic">{t('header.manualNote')}</p>
              </div>
            </div>

            <button
              onClick={() => setShowHelp(false)}
              className="w-full mt-6 py-3 bg-primary text-on-primary rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-primary/90 active:scale-95"
            >
              {t('header.gotIt')}
            </button>
          </div>
        </div>
      )}

      {/* Theme & Language Switchers - Far Left */}
      <div className="flex-1 flex justify-start items-center gap-5">
        <div className="flex items-center gap-3 group/header">
          <div className="flex items-center gap-1.5 grayscale opacity-50 group-hover/header:grayscale-0 group-hover/header:opacity-100 transition-all">
            <Palette size={12} className="text-primary" />
            <span className="text-[9px] uppercase font-black text-zinc-500 tracking-tighter">
              {t('header.themeLabel')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {[
              {
                id: 'ultraviolet',
                color: '#8b5cf6',
                label: t('header.themes.ultraviolet'),
              },
              {
                id: 'astro',
                color: '#3b82f6',
                label: t('header.themes.astro'),
              },
              {
                id: 'carbon',
                color: '#ffffff',
                label: t('header.themes.carbon'),
              },
              {
                id: 'emerald',
                color: '#10b981',
                label: t('header.themes.emerald'),
              },
              {
                id: 'bloodmoon',
                color: '#ef4444',
                label: t('header.themes.bloodmoon'),
              },
            ].map((th) => (
              <button
                key={th.id}
                onClick={() => onThemeChange(th.id)}
                className={`w-4 h-4 rounded-full transition-all hover:scale-125 active:scale-95 relative group/swatch ${currentTheme === th.id ? 'ring-2 ring-white ring-offset-2 ring-offset-black scale-110' : 'opacity-50 hover:opacity-100'}`}
                style={{
                  backgroundColor: th.color,
                  boxShadow: 'inset 0 0 0 1.5px var(--swatch-border)',
                }}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[9px] font-bold uppercase tracking-widest text-white opacity-0 group-hover/swatch:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                  {th.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Color Mode Toggle */}
        <div className="flex items-center gap-1 group/mode">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60">
            {(
              [
                {
                  id: 'light' as const,
                  Icon: Sun,
                  label: t('header.colorModes.light'),
                },
                {
                  id: 'dark' as const,
                  Icon: Moon,
                  label: t('header.colorModes.dark'),
                },
                {
                  id: 'system' as const,
                  Icon: Monitor,
                  label: t('header.colorModes.system'),
                },
              ] as const
            ).map(({ id, Icon, label }) => (
              <button
                key={id}
                onClick={() => onColorModeChange(id)}
                title={label}
                className={`relative p-1.5 rounded-md transition-all group/btn ${
                  colorMode === id
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-zinc-400 hover:text-primary hover:bg-zinc-800/60'
                }`}
              >
                <Icon size={11} />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[9px] font-bold uppercase tracking-widest text-white opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                  {label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Language Switcher */}
        <div className="relative" ref={langMenuRef}>
          <button
            onClick={() => setShowLangMenu((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-zinc-500 hover:text-primary hover:bg-zinc-900/60 transition-all border border-transparent hover:border-zinc-800"
            title={t('header.languageLabel')}
          >
            <Languages size={12} />
            <span className="text-[9px] font-black uppercase tracking-widest">
              {translations.languages[locale]}
            </span>
            <ChevronDown
              size={10}
              className={`transition-transform ${showLangMenu ? 'rotate-180' : ''}`}
            />
          </button>
          {showLangMenu && (
            <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-zinc-950/95 border border-zinc-800 rounded-md shadow-2xl z-[120] py-1 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
              {SUPPORTED_LOCALES.map((loc: Locale) => (
                <button
                  key={loc}
                  onClick={() => {
                    setLocale(loc)
                    setShowLangMenu(false)
                  }}
                  className={`block w-full text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${loc === locale ? 'bg-primary/20 text-primary' : 'text-zinc-400 hover:bg-primary hover:text-on-primary'}`}
                >
                  {translations.languages[loc]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Branding - Center */}
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl md:text-3xl font-black tracking-tighter text-white uppercase italic">
            Mobile Device{' '}
            <span className="text-primary not-italic">Studio</span>
          </h1>
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-zinc-800 rounded border border-zinc-700 mt-1">
            <span className="text-[10px] font-black text-zinc-400 tracking-wider">
              V{version}
            </span>
            <div
              className={`w-1.5 h-1.5 rounded-full ${binaryStatus.found ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse'}`}
            />
          </div>
        </div>
        <p className="text-zinc-600 text-[9px] uppercase tracking-[0.3em] font-black mt-1 ml-0.5">
          {t('header.tagline')}
        </p>
      </div>

      {/* Binary Status - Far Right */}
      <div className="flex flex-wrap gap-3 items-center flex-1 justify-end">
        {!binaryStatus.found && (
          <button
            onClick={() => setShowHelp(true)}
            className="px-4 py-2 glass rounded-xl border border-primary/50 text-primary hover:text-white transition-all hover:scale-105 hover:bg-primary/20 shadow-[0_0_15px_rgba(139,92,246,0.2)] flex items-center gap-2 group/help animate-pulse hover:animate-none"
            title={t('header.setupHelpTitle')}
          >
            <HelpCircle
              size={18}
              className="group-hover/help:rotate-12 transition-transform"
            />
            <span className="text-[10px] font-black uppercase tracking-widest">
              {t('header.setupHelp')}
            </span>
          </button>
        )}

        <div className="glass px-4 py-2 rounded-xl flex items-center gap-4 w-full md:w-auto justify-between md:justify-start border border-zinc-800 bg-zinc-950/50 backdrop-blur-2xl shadow-2xl relative group overflow-hidden">
          <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

          <div className="flex flex-col min-w-[110px] relative z-10">
            <div className="flex items-center gap-1.5 mb-1 text-zinc-500">
              <span className="text-[10px] uppercase font-black tracking-widest">
                {t('header.scrcpyEngine')}
              </span>
              <div
                className={`w-1.5 h-1.5 rounded-full ${binaryStatus.found ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-[pulse_2s_infinite]' : 'bg-yellow-500 animate-pulse'}`}
              />
            </div>
            <div
              className={`text-xs font-black uppercase tracking-tighter truncate max-w-[150px] ${binaryStatus.found ? 'text-emerald-400 animate-[pulse_4s_infinite]' : 'text-yellow-500'}`}
            >
              {isDownloading
                ? t('header.syncingComponents', { progress: downloadProgress })
                : binaryStatus.found
                  ? t('header.scrcpyReady')
                  : binaryStatus.message}
            </div>
            {isDownloading && (
              <div className="w-full bg-zinc-800 h-1 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                ></div>
              </div>
            )}
          </div>
          <div className="flex gap-2 items-center border-l border-zinc-800 pl-3 relative z-10">
            {!binaryStatus.found && !isDownloading && (
              <button
                onClick={onDownload}
                className="px-2 py-0.5 bg-emerald-500 text-black border border-emerald-400 rounded-md text-[9px] font-black hover:bg-emerald-400 transition-all uppercase tracking-tighter shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center gap-1"
              >
                <Download size={10} /> {t('header.installCore')}
              </button>
            )}
            <button
              onClick={onSetPath}
              className="p-1 hover:text-primary text-zinc-500 transition-colors"
              title={t('header.selectFolder')}
            >
              <FolderOpen size={16} />
            </button>
            <button
              onClick={onResetPath}
              className="p-1 hover:text-red-400 text-zinc-500 transition-colors"
              title={t('header.resetPath')}
            >
              <RefreshCcw size={16} />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
