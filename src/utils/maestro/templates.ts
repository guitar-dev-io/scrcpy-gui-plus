import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFieldValue,
  MaestroFlow,
  MaestroFlowAction,
} from '../../types/maestroBuilder'
import {
  createEmptyMaestroFlow,
  createMaestroFlowAction,
} from '../maestroBuilderFlow'

export type MaestroTemplateId =
  | 'blank'
  | 'cold-launch'
  | 'login'
  | 'payment'
  | 'smoke-test'

type MaestroTemplateActionBlueprint = {
  command: MaestroCommandId
  selector?: MaestroBuilderSelector
  config?: Record<string, MaestroFieldValue>
  children?: MaestroTemplateActionBlueprint[]
}

export type MaestroTemplateFactory = (appId: string) => MaestroFlowAction[]

export interface MaestroFlowTemplate {
  id: MaestroTemplateId
  name: string
  description: string
  factory: MaestroTemplateFactory
}

function action(
  command: MaestroCommandId,
  options: Omit<MaestroTemplateActionBlueprint, 'command'> = {},
): MaestroTemplateActionBlueprint {
  return { command, ...options }
}

const TEMPLATE_BLUEPRINTS: Record<
  Exclude<MaestroTemplateId, 'blank'>,
  MaestroTemplateActionBlueprint[]
> = {
  'cold-launch': [action('launchApp', { config: { stopApp: true } })],
  login: [
    action('launchApp', { config: { stopApp: true } }),
    action('tapOn', { selector: { type: 'id', value: 'username' } }),
    action('inputText', { config: { value: 'user@example.com' } }),
    action('tapOn', { selector: { type: 'id', value: 'password' } }),
    action('inputText', { config: { value: 'password' } }),
    action('tapOn', { selector: { type: 'text', value: 'Sign in' } }),
    action('assertVisible', { selector: { type: 'text', value: 'Welcome' } }),
  ],
  payment: [
    action('launchApp', { config: { stopApp: true } }),
    action('tapOn', { selector: { type: 'text', value: 'Pay' } }),
    action('assertVisible', {
      selector: { type: 'text', value: 'Payment successful' },
    }),
    action('takeScreenshot', { config: { name: 'payment-success' } }),
  ],
  'smoke-test': [
    action('launchApp', { config: { stopApp: true } }),
    action('assertVisible', { selector: { type: 'text', value: 'Home' } }),
  ],
}

function substituteAppId(value: string, appId: string): string {
  return value.replace(/\{\{appId\}\}/g, appId).replace(/\$\{appId\}/g, appId)
}

function resolveSelector(
  selector: MaestroBuilderSelector | undefined,
  appId: string,
): MaestroBuilderSelector | undefined {
  if (!selector) return undefined
  return {
    ...selector,
    value: substituteAppId(selector.value, appId),
    relatedValue: selector.relatedValue
      ? substituteAppId(selector.relatedValue, appId)
      : undefined,
  }
}

function resolveConfig(
  config: Record<string, MaestroFieldValue> | undefined,
  appId: string,
): Record<string, MaestroFieldValue> {
  if (!config) return {}
  return Object.fromEntries(
    Object.entries(config).map(([name, value]) => [
      name,
      typeof value === 'string' ? substituteAppId(value, appId) : value,
    ]),
  )
}

function createActionFromBlueprint(
  blueprint: MaestroTemplateActionBlueprint,
  appId: string,
): MaestroFlowAction {
  const created = createMaestroFlowAction(
    blueprint.command,
    resolveSelector(blueprint.selector, appId),
  )
  const children = blueprint.children?.map((child) =>
    createActionFromBlueprint(child, appId),
  )
  return {
    ...created,
    config: {
      ...created.config,
      ...resolveConfig(blueprint.config, appId),
    },
    ...(children === undefined ? {} : { children }),
  }
}

function createActionsFromBlueprints(
  blueprints: MaestroTemplateActionBlueprint[],
  appId: string,
): MaestroFlowAction[] {
  return blueprints.map((blueprint) =>
    createActionFromBlueprint(blueprint, appId),
  )
}

const template = (
  id: MaestroTemplateId,
  name: string,
  description: string,
  factory: MaestroTemplateFactory,
): MaestroFlowTemplate => ({ id, name, description, factory })

/** Generic, app-agnostic templates available to the Flow Builder. */
export const MAESTRO_FLOW_TEMPLATES: MaestroFlowTemplate[] = [
  template('blank', 'Blank', 'Start with an empty flow.', () => []),
  template(
    'cold-launch',
    'Cold Launch',
    'Restart the app from a clean launch.',
    (appId) =>
      createActionsFromBlueprints(TEMPLATE_BLUEPRINTS['cold-launch'], appId),
  ),
  template(
    'login',
    'Login',
    'A generic username and password sign-in flow.',
    (appId) => createActionsFromBlueprints(TEMPLATE_BLUEPRINTS.login, appId),
  ),
  template(
    'payment',
    'Payment',
    'A generic payment confirmation flow.',
    (appId) => createActionsFromBlueprints(TEMPLATE_BLUEPRINTS.payment, appId),
  ),
  template(
    'smoke-test',
    'Smoke Test',
    'Launch and verify a visible home element.',
    (appId) =>
      createActionsFromBlueprints(TEMPLATE_BLUEPRINTS['smoke-test'], appId),
  ),
]

export function getMaestroFlowTemplate(
  id: MaestroTemplateId,
): MaestroFlowTemplate {
  return (
    MAESTRO_FLOW_TEMPLATES.find((item) => item.id === id) ??
    MAESTRO_FLOW_TEMPLATES[0]
  )
}

/** Create a fresh structured flow; action ids are regenerated on every call. */
export function createMaestroFlowFromTemplate(
  id: MaestroTemplateId,
  appId: string,
): MaestroFlow {
  const selectedTemplate = getMaestroFlowTemplate(id)
  const flow = createEmptyMaestroFlow(appId, selectedTemplate.name)
  return {
    ...flow,
    actions: selectedTemplate.factory(appId),
  }
}
