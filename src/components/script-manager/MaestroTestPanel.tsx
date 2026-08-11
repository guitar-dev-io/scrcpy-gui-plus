import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Code2,
  FileCode2,
  FolderOpen,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  WandSparkles,
  XCircle,
} from 'lucide-react'
import { useMaestroTest } from '../../hooks/useMaestroTest'
import type { MaestroAction } from '../../types/maestro'
import {
  findMaestroCommand,
  MAESTRO_COMMAND_CATALOG,
  MAESTRO_COMMAND_CATEGORIES,
} from '../../utils/maestroCommandCatalog'
import {
  buildMaestroYaml,
  createMaestroAction,
  createWashXpressActions,
  MAESTRO_ACTION_LABELS,
  validateMaestroFlow,
} from '../../utils/maestroFlow'
import { formatRunDuration } from '../test-runner/testRunnerModel'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface MaestroTestPanelProps {
  activeDevice: string
  packageName: string
  notify: ToolbarNotifier
}

const FLOW_PATH_KEY = 'scrcpy_maestro_flow_path'
const fieldClass = 'h-7 min-w-0 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50'

export default function MaestroTestPanel({
  activeDevice,
  packageName,
  notify,
}: MaestroTestPanelProps) {
  const maestro = useMaestroTest(activeDevice)
  const [mode, setMode] = useState<'builder' | 'file'>('builder')
  const [flowPath, setFlowPath] = useState(() => localStorage.getItem(FLOW_PATH_KEY) ?? '')
  const [flowName, setFlowName] = useState('WashXpress smoke test')
  const [appId, setAppId] = useState(packageName || 'com.laundryyou.washxpress')
  const [actions, setActions] = useState<MaestroAction[]>(createWashXpressActions)
  const [selectedCommand, setSelectedCommand] = useState('tapOn')

  useEffect(() => {
    if (packageName && /^[A-Za-z0-9_.]+$/.test(packageName)) setAppId(packageName)
  }, [packageName])

  useEffect(() => {
    if (flowPath) localStorage.setItem(FLOW_PATH_KEY, flowPath)
  }, [flowPath])

  const validationError = validateMaestroFlow(appId, actions)
  const containsDataReset = actions.some((action) => (
    action.kind === 'customYaml' && /(^|\s)-(?:\s+)(?:clearState|clearKeychain)\b/m.test(action.yaml)
  ))
  const generatedYaml = useMemo(
    () => buildMaestroYaml(appId, flowName, actions),
    [actions, appId, flowName],
  )
  const selectedDefinition = findMaestroCommand(selectedCommand)

  const updateAction = (id: string, patch: Partial<MaestroAction>) => {
    setActions((current) => current.map((action) => (
      action.id === id ? { ...action, ...patch } as MaestroAction : action
    )))
  }

  const moveAction = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= actions.length) return
    setActions((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const loadWashXpressActions = () => {
    setAppId('com.laundryyou.washxpress')
    setFlowName('WashXpress smoke test')
    setActions(createWashXpressActions())
    setMode('builder')
  }

  const addSelectedCommand = () => {
    if (selectedCommand === '__custom__') {
      setActions((current) => [...current, createMaestroAction('customYaml')])
      return
    }
    const definition = findMaestroCommand(selectedCommand)
    if (!definition) return
    const action = definition.structuredKind
      ? createMaestroAction(definition.structuredKind)
      : {
          ...createMaestroAction('customYaml'),
          label: definition.name,
          yaml: definition.template,
        }
    setActions((current) => [...current, action])
  }

  const selectFlow = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Maestro flow', extensions: ['yaml', 'yml'] }],
      defaultPath: flowPath || undefined,
    })
    if (typeof selected === 'string') setFlowPath(selected)
  }

  const loadSampleFile = async () => {
    const path = await maestro.prepareSample()
    if (path) {
      setFlowPath(path)
      setMode('file')
    }
  }

  const output = useMemo(() => {
    if (maestro.error) return maestro.error
    if (!maestro.result) return ''
    return [maestro.result.stdout, maestro.result.stderr].filter((value) => value.trim()).join('\n')
  }, [maestro.error, maestro.result])

  const handleRun = async () => {
    if (mode === 'builder' && containsDataReset && !window.confirm(
      'This flow contains clearState or clearKeychain and can erase app data. Run it anyway?',
    )) return
    const result = mode === 'builder'
      ? await maestro.runGenerated(generatedYaml, 'maestro-builder-flow')
      : await maestro.run(flowPath)
    if (!result) return
    notify(
      result.success ? 'Maestro test passed' : 'Maestro test failed',
      `${formatRunDuration(result.durationMs)} · ${result.flowPath.split(/[\\/]/).pop()}`,
      result.success ? 'success' : 'error',
    )
  }

  const renderActionFields = (action: MaestroAction) => {
    if (action.kind === 'launchApp') {
      return (
        <select value={action.stopApp ? 'restart' : 'resume'} onChange={(event) => updateAction(action.id, { stopApp: event.target.value === 'restart' })} className={fieldClass}>
          <option value="restart">Cold launch / restart</option>
          <option value="resume">Resume existing session</option>
        </select>
      )
    }
    if (action.kind === 'tapOn' || action.kind === 'assertVisible' || action.kind === 'waitFor') {
      return (
        <>
          <select value={action.selectorType} onChange={(event) => updateAction(action.id, { selectorType: event.target.value as 'text' | 'id' })} className={`${fieldClass} w-16`}>
            <option value="text">Text</option>
            <option value="id">ID</option>
          </select>
          <input value={action.value} onChange={(event) => updateAction(action.id, { value: event.target.value })} placeholder={action.selectorType === 'text' ? 'Visible text or regex' : 'resource.id'} className={`${fieldClass} flex-1`} />
          {action.kind === 'waitFor' && (
            <input type="number" min={100} step={100} value={action.timeoutMs} onChange={(event) => updateAction(action.id, { timeoutMs: Number(event.target.value) })} title="Timeout in milliseconds" className={`${fieldClass} w-20`} />
          )}
        </>
      )
    }
    if (action.kind === 'inputText') {
      return <input value={action.value} onChange={(event) => updateAction(action.id, { value: event.target.value })} placeholder="Text to type" className={`${fieldClass} flex-1`} />
    }
    if (action.kind === 'pressKey') {
      return (
        <select value={action.key} onChange={(event) => updateAction(action.id, { key: event.target.value as 'Home' | 'Back' | 'Enter' })} className={fieldClass}>
          <option value="Back">Back</option>
          <option value="Home">Home</option>
          <option value="Enter">Enter</option>
        </select>
      )
    }
    if (action.kind === 'screenshot') {
      return <input value={action.name} onChange={(event) => updateAction(action.id, { name: event.target.value })} placeholder="Screenshot name" className={`${fieldClass} flex-1`} />
    }
    if (action.kind === 'customYaml') {
      return (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input value={action.label} onChange={(event) => updateAction(action.id, { label: event.target.value })} aria-label="Custom action name" placeholder="Action name" className={fieldClass} />
          <textarea value={action.yaml} onChange={(event) => updateAction(action.id, { yaml: event.target.value })} aria-label="Custom Maestro YAML" placeholder={'- retry:\n    maxRetries: 3\n    commands:\n      - tapOn: "Refresh"'} rows={4} spellCheck={false} className="min-h-16 w-full resize-y rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 py-1.5 font-mono text-[8px] leading-relaxed text-[var(--text-base)] outline-none focus:border-primary/50" />
        </div>
      )
    }
    return <span className="text-[8px] text-[var(--text-subtle)]">Wait until the current animation settles</span>
  }

  const status = maestro.running
    ? 'Running'
    : maestro.result?.success
      ? 'Passed'
      : maestro.result
        ? 'Failed'
        : maestro.availability?.found
          ? 'Ready'
          : 'CLI required'

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border-base)] bg-[var(--bg-surface)]">
      <header className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileCode2 size={15} className="text-primary" />
            <h2 className="text-xs font-semibold text-[var(--text-base)]">Maestro Flow Builder</h2>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[8px] font-semibold ${maestro.result?.success ? 'bg-emerald-500/10 text-emerald-400' : maestro.result ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-[var(--text-subtle)]'}`}>
            {status}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[9px] text-[var(--text-subtle)]">
          {maestro.checking ? <Loader2 size={10} className="animate-spin" /> : maestro.availability?.found ? <CheckCircle2 size={10} className="text-emerald-400" /> : <XCircle size={10} className="text-amber-400" />}
          <span className="truncate">{maestro.checking ? 'Checking Maestro CLI…' : maestro.availability?.found ? maestro.availability.version || 'Maestro CLI ready' : maestro.availability?.error || 'Maestro CLI is not installed'}</span>
          <button type="button" onClick={() => void maestro.refreshAvailability()} title="Check Maestro again" className="ml-auto rounded p-1 hover:bg-white/5 hover:text-primary"><RefreshCw size={10} /></button>
        </div>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-[var(--border-subtle)] px-3 py-2">
        <button type="button" onClick={() => setMode('builder')} className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-[9px] font-semibold ${mode === 'builder' ? 'bg-primary text-on-primary' : 'text-[var(--text-subtle)] hover:bg-white/5'}`}><WandSparkles size={11} /> Actions</button>
        <button type="button" onClick={() => setMode('file')} className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-[9px] font-semibold ${mode === 'file' ? 'bg-primary text-on-primary' : 'text-[var(--text-subtle)] hover:bg-white/5'}`}><Code2 size={11} /> YAML file</button>
        <button type="button" onClick={loadWashXpressActions} className="ml-auto rounded-md border border-primary/25 px-2 text-[8px] font-semibold text-primary hover:bg-primary/10">WashXpress preset</button>
      </div>

      {mode === 'builder' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-[var(--border-subtle)] p-3">
            <input value={flowName} onChange={(event) => setFlowName(event.target.value)} aria-label="Flow name" placeholder="Flow name" className={fieldClass} />
            <input value={appId} onChange={(event) => setAppId(event.target.value.trim())} aria-label="App package" placeholder="com.example.app" className={fieldClass} />
            <div className="col-span-2 flex gap-2">
              <select value={selectedCommand} onChange={(event) => setSelectedCommand(event.target.value)} aria-label="New Maestro action" title={selectedDefinition?.description} className={`${fieldClass} flex-1`}>
                {MAESTRO_COMMAND_CATEGORIES.map((category) => (
                  <optgroup key={category} label={category}>
                    {MAESTRO_COMMAND_CATALOG.filter((item) => item.category === category).map((item) => <option key={item.command} value={item.command}>{item.command} — {item.description}</option>)}
                  </optgroup>
                ))}
                <optgroup label="Custom">
                  <option value="__custom__">Custom YAML — Write any command block</option>
                </optgroup>
              </select>
              <button type="button" onClick={addSelectedCommand} className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[9px] font-semibold text-on-primary"><Plus size={11} /> Add action</button>
            </div>
            <p className="col-span-2 truncate text-[8px] text-[var(--text-subtle)]">{selectedDefinition ? selectedDefinition.description : `Custom command block · ${MAESTRO_COMMAND_CATALOG.length} official commands available`}</p>
          </div>

          <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
            {actions.map((action, index) => (
              <li key={action.id} className="rounded-lg border border-[var(--border-subtle)] bg-black/10 p-2">
                <div className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-right text-[8px] tabular-nums text-[var(--text-subtle)]">{index + 1}</span>
                  <span className="w-24 shrink-0 truncate text-[9px] font-semibold text-[var(--text-muted)]">{action.kind === 'customYaml' ? action.label : MAESTRO_ACTION_LABELS[action.kind]}</span>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">{renderActionFields(action)}</div>
                  <div className="flex shrink-0">
                    <button type="button" onClick={() => moveAction(index, -1)} disabled={index === 0} title="Move up" className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-20"><ArrowUp size={10} /></button>
                    <button type="button" onClick={() => moveAction(index, 1)} disabled={index === actions.length - 1} title="Move down" className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-20"><ArrowDown size={10} /></button>
                    <button type="button" onClick={() => setActions((current) => current.filter((item) => item.id !== action.id))} title="Delete action" className="rounded p-1 text-[var(--text-subtle)] hover:text-red-400"><Trash2 size={10} /></button>
                  </div>
                </div>
              </li>
            ))}
            {actions.length === 0 && <li className="rounded-lg border border-dashed border-[var(--border-subtle)] py-8 text-center text-[9px] text-[var(--text-subtle)]">Choose a command and add your first Maestro action.</li>}
          </ol>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <button type="button" onClick={() => void selectFlow()} className="flex w-full items-center gap-2 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 py-3 text-left text-[9px] text-[var(--text-muted)] hover:border-primary/40"><FolderOpen size={13} className="shrink-0 text-primary" /><span className="truncate">{flowPath || 'Select .yaml flow'}</span></button>
          <button type="button" onClick={() => void loadSampleFile()} className="w-full rounded-lg border border-primary/25 px-3 py-2 text-[9px] font-semibold text-primary hover:bg-primary/10">Use bundled WashXpress YAML</button>
          <p className="text-[9px] leading-relaxed text-[var(--text-subtle)]">Choose an existing Maestro YAML when the flow needs advanced commands not exposed by the visual Action Builder.</p>
        </div>
      )}

      {output && <pre aria-live="polite" className="max-h-24 shrink-0 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--border-subtle)] bg-black/25 p-3 font-mono text-[8px] leading-relaxed text-[var(--text-subtle)]">{output}</pre>}

      <footer className="shrink-0 border-t border-[var(--border-subtle)] p-3">
        {mode === 'builder' && validationError && <p className="mb-2 text-[8px] text-amber-400">{validationError}</p>}
        {mode === 'builder' && !validationError && containsDataReset && <p className="mb-2 text-[8px] text-amber-400">This flow contains an action that clears app data and will ask for confirmation before running.</p>}
        <button type="button" onClick={() => void handleRun()} disabled={!activeDevice || !maestro.availability?.found || maestro.running || (mode === 'builder' ? Boolean(validationError) : !flowPath)} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[10px] font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-35">
          {maestro.running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {maestro.running ? 'Running Maestro…' : mode === 'builder' ? `Run ${actions.length} actions` : 'Run YAML flow'}
        </button>
      </footer>
    </section>
  )
}
