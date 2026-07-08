/**
 * Per-view parse for an automation's `views/*.json` documents — pure (a filename plus
 * the raw JSON string, no fs, no Convex), so the publish gate
 * (`bundle_parse.ts`), tolerant discovery (`file_actions.ts::listAutomations`) and the
 * client upload mirror (`parse-automation-bundle.ts`) share ONE strict
 * `automationViewSchema` parse. A failure yields an ERROR STUB `{ id, error }` instead
 * of a view: publish throws on it, discovery surfaces it in place so the automation
 * page can render a repair affordance instead of silently dropping the page.
 */

import {
  type AutomationViewDoc,
  automationViewSchema,
} from '../../lib/shared/schemas/automation_views';
import { formatZodError } from '../../lib/shared/schemas/format-error';

export interface AutomationViewParseError {
  code: 'INVALID_VIEW';
  message: string;
}

export type AutomationViewParseResult =
  | { ok: true; view: AutomationViewDoc }
  | { ok: false; id: string; error: AutomationViewParseError };

/** The view id a doc falls back to when it declares none — the filename stem
 *  (`views/inbox.json` → `inbox`), mirroring `listAutomations`' historical fallback. */
export function viewIdFromFilename(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  return base.replace(/\.json$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strictly parse one view document. `filename` is the bundle-relative path
 * (used in messages and as the `id` fallback); `raw` is the file's JSON text.
 * Returns the parsed view (with `id` defaulted to the filename stem) or an
 * error stub with the Zod issues summarized human-readably.
 */
export function parseAutomationView(
  filename: string,
  raw: string,
): AutomationViewParseResult {
  const fallbackId = viewIdFromFilename(filename);

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      id: fallbackId,
      error: {
        code: 'INVALID_VIEW',
        message: `${filename} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const result = automationViewSchema.safeParse(doc);
  if (!result.success) {
    return {
      ok: false,
      // Keep the doc's own id when it carried one — the stub replaces THAT view.
      id:
        isRecord(doc) && typeof doc.id === 'string' && doc.id !== ''
          ? doc.id
          : fallbackId,
      error: {
        code: 'INVALID_VIEW',
        message: `${filename} rejected: ${formatZodError(result.error)}`,
      },
    };
  }

  return {
    ok: true,
    view: { ...result.data, id: result.data.id ?? fallbackId },
  };
}

/**
 * Every `AgentChat` role token a parsed view binds, across all its regions —
 * flat `data`, `tabs[].data`, `tabs[].columns[]`, and each region's `zones`.
 * Publish validates each against the manifest's `roles` map (the automation's cast);
 * an unknown role is a `VIEW_ROLE_UNKNOWN` publish error.
 */
export function collectAgentChatRoles(view: AutomationViewDoc): string[] {
  const roles: string[] = [];
  const walkRegion = (region: {
    content: { type: string; props: Record<string, unknown> }[];
    zones?: Record<string, { type: string; props: Record<string, unknown> }[]>;
  }): void => {
    const nodeLists = [region.content, ...Object.values(region.zones ?? {})];
    for (const nodes of nodeLists) {
      for (const node of nodes) {
        if (node.type === 'AgentChat' && typeof node.props.role === 'string') {
          roles.push(node.props.role);
        }
      }
    }
  };
  if (view.data) walkRegion(view.data);
  for (const tab of view.tabs ?? []) {
    if (tab.data) walkRegion(tab.data);
    for (const col of tab.columns ?? []) walkRegion(col);
  }
  return roles;
}
