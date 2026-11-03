// The catalog of the MCP server: every tool an assistant gets, in the order the
// README lists them. The tools are thin wrappers around `Manager` and `Remote`,
// so the rules are the same as for the web page, and an assistant can do
// everything the web page does (`compareRoutes` finds a route that has no tool).
// The one thing it cannot do is switch AI access.

import type { McpTool } from './tool.ts';
import { browserTools } from './tools-browser.ts';
import { overviewTools } from './tools-overview.ts';
import { proxyTools } from './tools-proxies.ts';
import { secretTools } from './tools-secrets.ts';
import { sessionTools } from './tools-sessions.ts';

export { MCP_TOOL_NAMES } from './tool.ts';
export type { McpTool, McpToolName } from './tool.ts';

export const MCP_TOOLS: readonly McpTool[] = [
  ...overviewTools,
  ...sessionTools,
  ...proxyTools,
  ...browserTools,
  ...secretTools,
];

const byName: ReadonlyMap<string, McpTool> = new Map(
  MCP_TOOLS.map((tool) => [tool.name, tool]),
);

export function findTool(name: string): McpTool | undefined {
  return byName.get(name);
}

/**
 * The routes of the web API that each tool does the same as: `METHOD /path`
 * relative to `/api`, `:id` for the number in the path, `WEBSOCKET` for the
 * live view (which the tools of the browser stand for). A tool can mirror
 * several routes (adding proxies has two), or none (`wait`).
 */
export const MCP_TOOL_ROUTES: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool.routes]));

/** `GET /sessions/:session_id` is `GET /sessions/:id`, whatever the number is called. */
export function normalizeRoute(route: string): string {
  return route.replace(/:[A-Za-z_]+/g, ':id');
}

/**
 * Compares the routes of the web API with the ones the tools mirror: the
 * routes that no tool does the same as (an assistant could not do it), and the
 * routes a tool names that the API does not have (a tool that is out of date).
 */
export function compareRoutes(apiRoutes: readonly string[]): {
  untooled: string[];
  unknown: string[];
} {
  const api = new Set(apiRoutes.map(normalizeRoute));
  const tooled = new Set(
    MCP_TOOLS.flatMap((tool) => tool.routes).map(normalizeRoute),
  );
  return {
    untooled: [...api].filter((route) => !tooled.has(route)).sort(),
    unknown: [...tooled].filter((route) => !api.has(route)).sort(),
  };
}
