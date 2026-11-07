// What a tool of the MCP server is: its name, what the model reads about it,
// the zod schema its arguments are checked with (and `tools/list` advertises as
// JSON Schema, so the two cannot differ), and the function that does the work.
//
// A call goes: arguments checked, tool run, answer shaped. What a tool refuses
// with (`ToolError`, or the `AppError` and `RemoteError` that the rules and the
// browser answer with) is the model's to read: a result flagged `isError` with
// the sentence. Arguments that miss the schema are one too (every problem at
// once), never a protocol error. Anything else is a fault: logged, and the
// model hears only that it happened.

import { Buffer } from 'node:buffer';

import { z } from 'zod';

import { AppError } from '../../errors.ts';
import { RemoteError } from '../browser/remote.ts';
import type { Manager } from '../sessions/manager.ts';

/**
 * The names an assistant calls the tools by (the README lists them, and so
 * does the settings page: `tests/guards/tool-names.guard.test.ts` keeps the
 * two in step).
 */
export const MCP_TOOL_NAMES = [
  // overview and settings
  'overview',
  'get_settings',
  'set_start_page',
  // sessions
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
  // proxies
  'list_proxies',
  'add_proxies',
  'check_proxy',
  'check_proxies',
  'delete_proxy',
  // a running session's browser
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
  // secrets and notes
  'list_secrets',
  'get_secret',
  'type_secret',
  'create_secret',
  'update_secret',
  'delete_secret',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** The README's groups of tools. */
export type ToolGroup =
  | 'overview'
  | 'sessions'
  | 'proxies'
  | 'browser'
  | 'secrets';

/** What a client may know about a tool's effects (MCP's `ToolAnnotations`). */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true };
export const DESTRUCTIVE: ToolAnnotations = { destructiveHint: true };

/** What a tool needs of the app. */
export interface ToolContext {
  readonly manager: Manager;
  /**
   * Multiplies the short waits a tool makes (the time a page gets to react,
   * the polling while a session starts). 1 in the app; tests use less.
   */
  readonly waitScale: number;
  /**
   * Whether AI access is still on. A tool that waits looks at it as it waits
   * (`sleepWhileOn`, `until`) and gives up with `AccessOffError` when it is not
   * any more; no look means no switch to watch.
   */
  readonly accessOn?: (() => boolean) | undefined;
}

/**
 * AI access was switched off while a tool waited. Not a refusal in the tool's
 * words: the endpoint answers it with the error of the switch, and the model
 * hears nothing else.
 */
export class AccessOffError extends Error {
  constructor() {
    super('AI access is off. Turn it on in Settings.');
    this.name = 'AccessOffError';
  }
}

/** A refusal in a tool's own words: the model reads it and tries something else. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

// -- results ----------------------------------------------------------------------

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** MCP's `CallToolResult`. */
export interface ToolResult {
  content: ContentBlock[];
  isError?: true;
}

/** What a tool returns: text for the model, or a result of its own (a picture). */
export type ToolOutput = string | ToolResult;

/** An object or a list, as JSON text the model can read. */
export function json(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

/** A JPEG as an MCP image: base64. */
export function jpegImage(jpeg: Uint8Array): ToolResult {
  return {
    content: [
      {
        type: 'image',
        data: Buffer.from(jpeg).toString('base64'),
        mimeType: 'image/jpeg',
      },
    ],
  };
}

function textResult(text: string, isError = false): ToolResult {
  const content: ContentBlock[] = [{ type: 'text', text }];
  return isError ? { content, isError: true } : { content };
}

/** A result that says the call did not do its job. */
export function failure(message: string): ToolResult {
  return textResult(message, true);
}

// -- arguments ---------------------------------------------------------------------

/** The most problems one refusal lists. */
const MAX_ISSUES = 10;

/**
 * What is wrong with one argument, in a few words. zod only says "Invalid
 * input" of a value that fits none of the kinds an argument may be (a session
 * is a name or an id); the model needs to hear which kinds those are.
 */
function problemOf(issue: z.core.$ZodIssue): string {
  if (issue.code !== 'invalid_union') return issue.message;
  const kinds = issue.errors.map((branch) =>
    branch
      .map(problemOf)
      .join('; ')
      .replace(/^Invalid input: /, ''),
  );
  return [...new Set(kinds)].join(', or ');
}

/**
 * Every problem of arguments that miss the schema, one line each. A value is
 * never quoted: it may be a password.
 */
function describeIssues(tool: string, error: z.ZodError): string {
  const lines = error.issues.flatMap((issue) => {
    const path = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map(
        (key) =>
          `- ${[...path, key].join('.')}: is not ${path.length === 0 ? 'an argument of this tool' : 'a field of this object'}`,
      );
    }
    return [
      `- ${path.length === 0 ? 'arguments' : path.join('.')}: ${problemOf(issue)}`,
    ];
  });
  const more = lines.length - MAX_ISSUES;
  const shown = lines.slice(0, MAX_ISSUES);
  if (more > 0) shown.push(`- and ${more} more`);
  return `Invalid arguments for ${tool}:\n${shown.join('\n')}`;
}

/**
 * The JSON Schema `tools/list` advertises for a tool's arguments (2020-12, the
 * default dialect since MCP 2025-11-25, so no `$schema` marker: an older client
 * with a draft-07 validator would refuse an unknown one). Integers are said to
 * be integers only; zod's bounds for a "safe integer" are noise to a model.
 */
function inputSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    override({ jsonSchema }) {
      if (jsonSchema.type !== 'integer') return;
      if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) {
        delete jsonSchema.minimum;
      }
      if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) {
        delete jsonSchema.maximum;
      }
    },
  });
  return rest;
}

// -- the definition ----------------------------------------------------------------

export interface ToolSpec<Args> {
  name: McpToolName;
  group: ToolGroup;
  /** A name for people. */
  title: string;
  /** What the model reads to decide whether and how to use the tool. */
  description: string;
  /** The arguments: a strict object, so a misspelt name is refused by name. */
  input: z.ZodType<Args>;
  annotations?: ToolAnnotations;
  /**
   * The routes of the web API that do the same, `METHOD /path` relative to
   * `/api` with `:id` for the number in the path. The web page and an
   * assistant can do the same things; `compareRoutes` checks it.
   */
  routes: readonly string[];
  run: (args: Args, context: ToolContext) => Promise<ToolOutput>;
}

export interface McpTool {
  readonly name: McpToolName;
  readonly group: ToolGroup;
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  readonly routes: readonly string[];
  readonly inputSchema: Record<string, unknown>;
  /**
   * Checks the arguments and runs the tool; never throws, except with the
   * `AccessOffError` of a tool that saw AI access switched off while it waited.
   */
  call(rawArguments: unknown, context: ToolContext): Promise<ToolResult>;
}

export function defineTool<Args>(spec: ToolSpec<Args>): McpTool {
  return {
    name: spec.name,
    group: spec.group,
    title: spec.title,
    description: spec.description,
    annotations: spec.annotations ?? {},
    routes: spec.routes,
    inputSchema: inputSchemaOf(spec.input),

    async call(rawArguments, context) {
      const parsed = spec.input.safeParse(rawArguments ?? {});
      if (!parsed.success)
        return failure(describeIssues(spec.name, parsed.error));
      try {
        const output = await spec.run(parsed.data, context);
        return typeof output === 'string' ? textResult(output) : output;
      } catch (error) {
        if (error instanceof AccessOffError) throw error;
        if (
          error instanceof ToolError ||
          error instanceof AppError ||
          error instanceof RemoteError
        ) {
          return failure(error.message);
        }
        // What went wrong may name a path or a query: it stays in the log.
        console.error(`the MCP tool ${spec.name} failed`, error);
        return failure(
          `${spec.name} failed unexpectedly. The app's log has the details.`,
        );
      }
    },
  };
}
