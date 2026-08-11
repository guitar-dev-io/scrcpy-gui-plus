// Backwards-compatible entry point for the flow library menu. The template
// definitions live in the standalone Maestro utility module so they can be
// consumed without coupling callers to the builder hook.
export {
  MAESTRO_FLOW_TEMPLATES,
  createMaestroFlowFromTemplate,
  getMaestroFlowTemplate,
} from './maestro/templates'
export type {
  MaestroFlowTemplate,
  MaestroTemplateFactory,
  MaestroTemplateId,
} from './maestro/templates'
