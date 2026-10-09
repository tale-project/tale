import { MCP_DOC_TOPICS, type McpDocTopic } from './docs/topics';
import {
  MCP_FRESH_FOR_A_LISTING_MS,
  MCP_FRESH_FOR_A_RELEASE_MS,
} from './server';

/**
 * The MCP endpoint's resources — what a client can read by address instead
 * of by tool call (Claude Code offers them as `@tale:tale://…` mentions).
 * Every resource is a read a tool already answers, and reading it goes
 * through that tool (`backend/domains/mcp/resources.ts`): one answer, one
 * authorization, so a resource can never show what the tool would refuse.
 *
 * This module holds what a client can depend on and nothing that reads the
 * database: the fixed resources, the address templates, and how an address
 * maps to its tool call. The contract fingerprint covers the first two.
 */

/** The node kinds `get_catalog` narrows to — the core kinds the grammar
 * teaches, then the connector actions this deployment can run. */
export const CATALOG_KINDS = [
  'transform',
  'llm',
  'agent',
  'subautomation',
  'connector',
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** One fixed resource, as `resources/list` lists it. */
export interface McpResourceListing {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: 'text/markdown' | 'application/json';
}

/** One address template, as `resources/templates/list` lists it. */
export interface McpResourceTemplate {
  readonly uriTemplate: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: 'application/json';
}

const DOC_TITLES: Readonly<
  Record<McpDocTopic, { title: string; description: string }>
> = {
  authoring: {
    title: 'Automation authoring reference',
    description:
      'The automation grammar and every method — what get_docs answers. Read it once per session before writing a document.',
  },
  triggers: {
    title: 'Triggers reference',
    description:
      'What starts an automation: each trigger kind with its fields and the input its runs start with, webhook delivery, and the events.',
  },
  validation: {
    title: 'Validation reference',
    description:
      'How to read what validate_automation answers, and every issue code with its level and the rule it protects.',
  },
  skill: {
    title: 'The Tale skill (SKILL.md)',
    description:
      'The Agent Skills file for working in Tale through this server — save it as .claude/skills/tale/SKILL.md or .agents/skills/tale/SKILL.md.',
  },
};

const CATALOG_TITLES: Readonly<
  Record<CatalogKind, { title: string; description: string }>
> = {
  transform: {
    title: 'Node kind: transform',
    description: 'The transform node — its section of the authoring reference.',
  },
  llm: {
    title: 'Node kind: llm',
    description: 'The llm node — its section of the authoring reference.',
  },
  agent: {
    title: 'Node kind: agent',
    description: 'The agent node — its section of the authoring reference.',
  },
  subautomation: {
    title: 'Node kind: subautomation',
    description:
      'The subautomation node — its section of the authoring reference.',
  },
  connector: {
    title: 'Connector actions',
    description:
      'Every connector action this deployment can run, by name and description; get_catalog with kind "connector" adds their input schemas.',
  },
};

/** The resources every caller can read, in the order they are listed:
 * the references, then the catalog. */
export const MCP_STATIC_RESOURCES: readonly McpResourceListing[] = [
  ...MCP_DOC_TOPICS.map((topic): McpResourceListing => ({
    uri: `tale://docs/${topic}`,
    name: `docs/${topic}`,
    ...DOC_TITLES[topic],
    mimeType: 'text/markdown',
  })),
  ...CATALOG_KINDS.map((kind): McpResourceListing => ({
    uri: `tale://catalog/${kind}`,
    name: `catalog/${kind}`,
    ...CATALOG_TITLES[kind],
    mimeType: 'application/json',
  })),
];

/** The addresses a client fills in: `{name}` is an automation's name with
 * every "/" percent-encoded (RFC 6570 simple expansion), `{version}` a saved
 * version number or `deployed`. */
export const MCP_RESOURCE_TEMPLATES: readonly McpResourceTemplate[] = [
  {
    uriTemplate: 'tale://automations/{name}',
    name: 'automation',
    title: 'Automation',
    description:
      'The latest saved version of an automation, as get_automation answers it. Encode "/" in the name: tale://automations/billing%2Fdunning.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'tale://automations/{name}/versions/{version}',
    name: 'automation-version',
    title: 'Automation version',
    description:
      'One saved version of an automation, as get_automation answers it — a version number, or deployed for the live one.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'tale://runs/{runId}',
    name: 'run',
    title: 'Run',
    description:
      'One run in full — status, output, trace and effects — as get_run answers it.',
    mimeType: 'application/json',
  },
];

/** The address of one automation — and of one of its versions — the way
 * the listing writes it. */
export function automationResourceUri(
  name: string,
  version?: number | 'deployed',
): string {
  const base = `tale://automations/${encodeURIComponent(name)}`;
  return version === undefined ? base : `${base}/versions/${version}`;
}

/** The address of one run. */
export function runResourceUri(runId: string): string {
  return `tale://runs/${encodeURIComponent(runId)}`;
}

/** What reading an address means: the tool call that answers it, and how its
 * answer becomes the resource's contents — the reference's text as
 * markdown, or the whole answer as JSON. */
export interface ResourceTarget {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly mimeType: 'text/markdown' | 'application/json';
  /** The answer's field that is the resource's text; absent, the whole
   * answer is. */
  readonly textField?: 'docs';
}

/** A path segment, decoded; null when its escapes are malformed. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** A version segment: a saved version number or `deployed`. */
function versionSegment(segment: string): number | 'deployed' | null {
  if (segment === 'deployed') return 'deployed';
  return /^[1-9][0-9]{0,8}$/.test(segment) ? Number(segment) : null;
}

/**
 * The tool call an address stands for, or why it stands for none:
 * `unknown` — not an address this server serves (a client gets "resource
 * not found"); `invalid` — a served address with a part that cannot be one
 * (a version that is not a number, a malformed escape).
 *
 * An automation's name is read percent-decoded, so `billing%2Fdunning` is
 * `billing/dunning`; a name typed with its "/" left raw reads too, with a
 * trailing `/versions/<version>` taken as the version.
 */
export function resourceTarget(
  uri: string,
): ResourceTarget | { readonly problem: 'unknown' | 'invalid' } {
  const match = /^tale:\/\/([a-z]+)\/(.+)$/.exec(uri);
  if (match === null) return { problem: 'unknown' };
  const [, family = '', path = ''] = match;
  if (family === 'docs') {
    const topic = MCP_DOC_TOPICS.find((candidate) => candidate === path);
    return topic === undefined
      ? { problem: 'unknown' }
      : {
          tool: 'get_docs',
          args: { topic },
          mimeType: 'text/markdown',
          textField: 'docs',
        };
  }
  if (family === 'catalog') {
    const kind = CATALOG_KINDS.find((candidate) => candidate === path);
    return kind === undefined
      ? { problem: 'unknown' }
      : {
          tool: 'get_catalog',
          args: kind === 'connector' ? { kind, compact: true } : { kind },
          mimeType: 'application/json',
        };
  }
  if (family === 'runs') {
    const runId = decodeSegment(path);
    if (runId === null || runId.trim() === '') return { problem: 'invalid' };
    return { tool: 'get_run', args: { runId }, mimeType: 'application/json' };
  }
  if (family === 'automations') {
    const segments = path.split('/');
    const versioned =
      segments.length >= 3 && segments[segments.length - 2] === 'versions';
    const rawName = versioned
      ? segments.slice(0, -2).join('/')
      : segments.join('/');
    const name = decodeSegment(rawName);
    if (name === null || name.trim() === '') return { problem: 'invalid' };
    if (!versioned) {
      return {
        tool: 'get_automation',
        args: { name },
        mimeType: 'application/json',
      };
    }
    const version = versionSegment(segments[segments.length - 1] ?? '');
    if (version === null) return { problem: 'invalid' };
    return {
      tool: 'get_automation',
      args: { name, version },
      mimeType: 'application/json',
    };
  }
  return { problem: 'unknown' };
}

/**
 * How long a client may keep what reading `uri` answered, in milliseconds
 * (the modern revision's `ttlMs`): a reference and a core node kind's
 * section change only with a release; the connector catalog when someone
 * connects a connector, so for a minute; an automation and a run not at
 * all — an agent reads an automation again right after its own save, and a
 * cached copy would show the version before it.
 */
export function resourceFreshnessMs(uri: string): number {
  const target = resourceTarget(uri);
  if ('problem' in target) return 0;
  if (target.tool === 'get_docs') return MCP_FRESH_FOR_A_RELEASE_MS;
  if (target.tool === 'get_catalog') {
    return target.args.kind === 'connector'
      ? MCP_FRESH_FOR_A_LISTING_MS
      : MCP_FRESH_FOR_A_RELEASE_MS;
  }
  return 0;
}
