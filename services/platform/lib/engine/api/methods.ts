/**
 * The names of the engine's methods — every authoring and management call
 * `dispatch()` answers. A leaf: the MCP tool inventory a settings page lists
 * reads it without loading the engine (its parser, validator and executor)
 * behind the methods.
 */

export const METHODS = [
  'get_docs',
  'get_catalog',
  'search_catalog',
  'validate_automation',
  'run_automation',
  'test_automation',
  'save_automation',
  'get_automation',
  'list_automations',
  'deploy_automation',
  'delete_automation',
  'set_trigger',
  'run_deployed',
  'start_run',
  'list_runs',
  'get_run',
  'get_run_node',
  'compare_runs',
  'cancel_run',
  'answer_run_ask',
  'list_versions',
  'set_automation_projects',
  'list_triggers',
  'delete_trigger',
] as const;

export type Method = (typeof METHODS)[number];
