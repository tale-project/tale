export type ToolGroupKey =
  | 'overview'
  | 'sessions'
  | 'proxies'
  | 'browser'
  | 'secrets';

export interface ToolGroup {
  key: ToolGroupKey;
  /** The names an assistant calls the tools by. They are identifiers, not words, so they are not translated. */
  tools: readonly string[];
}

/**
 * The tools an assistant gets, grouped as the README's table lists them. An
 * assistant can do everything the web page does, so a tool the backend's MCP
 * server gains or loses changes this list too: it is the only copy the page
 * keeps.
 */
export const TOOL_GROUPS = [
  {
    key: 'overview',
    tools: ['overview', 'get_settings', 'set_start_page'],
  },
  {
    key: 'sessions',
    tools: [
      'list_sessions',
      'get_session',
      'create_session',
      'start_session',
      'stop_session',
      'restart_session',
      'rotate_session_ip',
      'check_session_ip',
      'rename_session',
      'delete_session',
      'export_proxies',
    ],
  },
  {
    key: 'proxies',
    tools: [
      'list_proxies',
      'add_proxies',
      'check_proxy',
      'check_proxies',
      'delete_proxy',
    ],
  },
  {
    key: 'browser',
    tools: [
      'show_window',
      'list_tabs',
      'open_tab',
      'switch_tab',
      'close_tab',
      'navigate',
      'history',
      'read_page',
      'screenshot',
      'click',
      'hover',
      'drag',
      'type_text',
      'press_key',
      'scroll',
      'get_selected_text',
      'handle_dialog',
      'wait',
    ],
  },
  {
    key: 'secrets',
    tools: [
      'list_secrets',
      'get_secret',
      'type_secret',
      'create_secret',
      'update_secret',
      'delete_secret',
    ],
  },
] as const satisfies readonly ToolGroup[];
