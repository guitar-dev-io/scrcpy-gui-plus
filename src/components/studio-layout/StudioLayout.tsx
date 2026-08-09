import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Layout,
  Model,
  type Action,
  type IJsonModel,
  type ILayoutApi,
  type TabNode,
} from 'flexlayout-react'
import 'flexlayout-react/style/dark.css'
import './studio-layout.css'

export interface StudioPanelContext {
  /** Stable value from the tab's `component`, falling back to its node id. */
  panelId: string
  /** FlexLayout node for panel-specific layout metadata only. */
  node: TabNode
  /** Serializable, panel-specific layout configuration. */
  config: unknown
}

export type StudioPanelFactory = (context: StudioPanelContext) => ReactNode
export type StudioPanel = ReactNode | StudioPanelFactory
export type StudioPanelRegistry = Readonly<Record<string, StudioPanel>>

export interface StudioLayoutChange {
  action: Action
  model: Model
}

export interface StudioLayoutProps {
  /** Used once to create the layout model. It should contain layout state, not app state. */
  initialLayout: IJsonModel
  /** Optional controlled layout snapshot, useful for restoring an external preset. */
  layout?: IJsonModel
  /** React content keyed by each tab node's `component` value. */
  panels?: StudioPanelRegistry
  /** Called when a panel is not present in `panels`. */
  panelFactory?: StudioPanelFactory
  /** Rendered for an unresolved panel id. */
  missingPanel?: ReactNode | StudioPanelFactory
  /** Receives a serializable snapshot after drag, resize, select, add, or close actions. */
  onLayoutChange?: (layout: IJsonModel, change: StudioLayoutChange) => void
  /** Can transform an action or return undefined to prevent it. */
  onAction?: (action: Action) => Action | undefined
  className?: string
  realtimeResize?: boolean
  supportsPopout?: boolean
  'aria-label'?: string
}

export interface StudioLayoutHandle {
  getModel: () => Model
  getLayout: () => IJsonModel
  getLayoutApi: () => ILayoutApi | null
  restoreLayout: (layout: IJsonModel) => void
}

function hasPanel(
  panels: StudioPanelRegistry | undefined,
  panelId: string,
): panels is StudioPanelRegistry {
  return Boolean(panels && Object.prototype.hasOwnProperty.call(panels, panelId))
}

function renderPanel(panel: StudioPanel, context: StudioPanelContext) {
  return typeof panel === 'function'
    ? (panel as StudioPanelFactory)(context)
    : panel
}

/**
 * Dockable studio shell. The FlexLayout model owns only panel placement and sizing;
 * callers remain the single source of truth for device, session, and tool state.
 */
const StudioLayout = forwardRef<StudioLayoutHandle, StudioLayoutProps>(
  function StudioLayout(
    {
      initialLayout,
      layout,
      panels,
      panelFactory,
      missingPanel,
      onLayoutChange,
      onAction,
      className = '',
      realtimeResize = true,
      supportsPopout = false,
      'aria-label': ariaLabel = 'Studio workspace',
    },
    ref,
  ) {
    const [model, setModel] = useState(() =>
      Model.fromJson(layout ?? initialLayout),
    )
    const modelRef = useRef(model)
    const layoutApiRef = useRef<ILayoutApi>(null)
    const lastExternalLayoutRef = useRef(layout)
    const lastEmittedLayoutRef = useRef<IJsonModel | undefined>(undefined)

    modelRef.current = model

    // A changed controlled snapshot is treated as an explicit restore. Passing the
    // snapshot emitted by onLayoutChange back in does not recreate the model.
    useEffect(() => {
      if (
        !layout ||
        layout === lastExternalLayoutRef.current ||
        layout === lastEmittedLayoutRef.current
      ) {
        lastExternalLayoutRef.current = layout
        return
      }

      lastExternalLayoutRef.current = layout
      setModel((previousModel) => Model.fromJson(layout, previousModel))
    }, [layout])

    const restoreLayout = useCallback((nextLayout: IJsonModel) => {
      setModel((previousModel) => Model.fromJson(nextLayout, previousModel))
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        getModel: () => modelRef.current,
        getLayout: () => modelRef.current.toJson(),
        getLayoutApi: () => layoutApiRef.current,
        restoreLayout,
      }),
      [restoreLayout],
    )

    const factory = useCallback(
      (node: TabNode) => {
        const panelId = node.getComponent() ?? node.getId()
        const context: StudioPanelContext = {
          panelId,
          node,
          config: node.getConfig(),
        }

        if (hasPanel(panels, panelId)) {
          return renderPanel(panels[panelId], context)
        }
        if (panelFactory) return panelFactory(context)
        if (missingPanel !== undefined) return renderPanel(missingPanel, context)

        return (
          <div className="studio-layout__missing-panel" role="status">
            Panel &ldquo;{panelId}&rdquo; is unavailable.
          </div>
        )
      },
      [missingPanel, panelFactory, panels],
    )

    const handleModelChange = useCallback(
      (nextModel: Model, action: Action) => {
        const snapshot = nextModel.toJson()
        lastEmittedLayoutRef.current = snapshot
        onLayoutChange?.(snapshot, { action, model: nextModel })
      },
      [onLayoutChange],
    )

    return (
      <section
        className={`studio-layout ${className}`.trim()}
        aria-label={ariaLabel}
      >
        <Layout
          ref={layoutApiRef}
          model={model}
          factory={factory}
          onAction={onAction}
          onModelChange={handleModelChange}
          realtimeResize={realtimeResize}
          supportsPopout={supportsPopout}
        />
      </section>
    )
  },
)

export default StudioLayout
