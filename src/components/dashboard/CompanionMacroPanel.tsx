import { useState } from 'react'
import { Circle, Play, Repeat, Square, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { useCompanionMacros } from '../../hooks/useCompanionMacros'
import { macroDurationMs } from '../../utils/companionMacro'
import { formatRecordingElapsed } from '../../utils/canvasRecorder'

interface CompanionMacroPanelProps {
  macros: ReturnType<typeof useCompanionMacros>
  canControl: boolean
  onError: (message: string) => void
}

const sectionTitle =
  'flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]'

/** Record what you do on the Companion screen, then replay it. */
export default function CompanionMacroPanel({ macros, canControl, onError }: CompanionMacroPanelProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [speed, setSpeed] = useState(1)

  const play = async (macro: Parameters<typeof macros.play>[0]) => {
    try {
      await macros.play(macro, speed)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="mt-4 space-y-1.5 border-t border-[var(--border-subtle)] pt-4">
      <p className={sectionTitle}>
        <Repeat size={11} /> {t('companion.macros.title')}
      </p>
      {macros.recording ? (
        <div className="space-y-1.5 rounded-md border border-red-500/40 bg-red-500/10 p-2">
          <p className="text-[9px] text-red-200">
            {t('companion.macros.recording', { count: macros.stepCount })}
          </p>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('companion.macros.namePlaceholder')}
            className="h-7 w-full rounded border border-[var(--border-base)] bg-black/20 px-2 text-[10px] text-[var(--text-base)] outline-none"
          />
          <button
            type="button"
            onClick={() => {
              macros.stopRecording(name)
              setName('')
            }}
            className="flex h-7 w-full items-center justify-center gap-1.5 rounded bg-red-500/80 text-[9px] font-semibold text-white hover:bg-red-500"
          >
            <Square size={9} className="fill-current" /> {t('companion.macros.stopAndSave')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!canControl || macros.playing !== null}
          onClick={macros.startRecording}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-base)] text-[9px] font-semibold text-[var(--text-muted)] hover:border-red-400/50 hover:text-red-300 disabled:opacity-40"
        >
          <Circle size={9} className="fill-red-500 text-red-500" /> {t('companion.macros.record')}
        </button>
      )}

      {macros.macros.length > 0 && (
        <>
          <div className="flex items-center justify-between text-[9px] text-[var(--text-subtle)]">
            <span>{t('companion.macros.speed')}</span>
            <div className="flex gap-0.5">
              {[1, 2, 4].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={speed === value}
                  onClick={() => setSpeed(value)}
                  className={`rounded px-1.5 py-0.5 font-semibold ${speed === value ? 'bg-primary/20 text-primary' : 'hover:text-primary'}`}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {macros.macros.map((macro) => {
              const active = macros.playing?.id === macro.id
              return (
                <li key={macro.id} className="flex items-center gap-1 rounded border border-[var(--border-subtle)] px-1.5 py-1">
                  <button
                    type="button"
                    disabled={!canControl || macros.recording || (macros.playing !== null && !active)}
                    onClick={() => (active ? macros.stopPlaying() : void play(macro))}
                    aria-label={active ? t('companion.macros.stop') : t('companion.macros.play', { name: macro.name })}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-primary hover:bg-primary/15 disabled:opacity-40"
                  >
                    {active ? <Square size={10} className="fill-current" /> : <Play size={11} />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] text-[var(--text-base)]">{macro.name}</span>
                    <span className="block text-[8px] text-[var(--text-subtle)]">
                      {active && macros.playing
                        ? t('companion.macros.progress', { step: macros.playing.step, total: macros.playing.total })
                        : `${macro.steps.length} · ${formatRecordingElapsed(macroDurationMs(macro.steps))}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={active}
                    onClick={() => macros.deleteMacro(macro.id)}
                    aria-label={t('companion.macros.delete', { name: macro.name })}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:text-red-400 disabled:opacity-40"
                  >
                    <Trash2 size={10} />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
