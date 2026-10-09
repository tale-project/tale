/**
 * What a document names of the organization, against what the organization
 * has: the skills, connectors, secrets and agent runtime of an `agent` step,
 * the connector a capability step acts through, and the event the
 * automation's trigger waits for. The facts come from the host
 * (`StoreAdapter.orgFacts`), asked once per validation for only what the
 * document names.
 *
 * Every finding is a warning: the organization can change between a save and
 * a run (a skill added, a connector connected), exactly like the model check
 * (`LLM_MODEL_UNAVAILABLE`). A fact the host could not tell — a lookup that
 * failed or ran out of time, or one the caller may not see — warns about
 * nothing. What a run does without the thing differs, and each sentence says
 * so: a missing skill or runtime fails the step, a missing connector leaves
 * the step without that app, and a missing secret is simply absent.
 *
 * Pure: the host supplies the facts, so an editor can run the same pass.
 */

import { warn } from '../errors';
import { nodeTypes, type OrgFacts, type OrgFactsQuery } from '../slots';
import { ptr } from '../syntax/pointer';
import type { Issue, NodeDef } from '../types';
import { closestName } from '../validate/similar';

/** What the pass reads of a validated document. */
export interface OrgStateInput {
  doc: Record<string, unknown>;
  /** The nodes the node pass accepted, first occurrence of each id. */
  nodes: readonly NodeDef[];
  /** A node's position in `doc.nodes`. */
  indexOf(node: NodeDef): number;
}

/** The entries of an agent step's list field that name something — a
 * template resolves at run time, so it names nothing yet. */
function namedEntries(value: unknown): Array<{ index: number; name: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ index: number; name: string }> = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    if (name === '' || name.includes('{{')) continue;
    out.push({ index, name });
  }
  return out;
}

/** The connector a capability step acts through: the `<connector>` of its
 * `<connector>.<action>` type, when the type is a registered connector
 * action. */
function capabilityConnector(node: NodeDef): string | undefined {
  const def = nodeTypes().get(node.type);
  if (def?.kind !== 'connector' || def.connector === undefined) {
    return undefined;
  }
  const dot = node.type.indexOf('.');
  return dot > 0 ? node.type.slice(0, dot) : undefined;
}

function isAgent(node: NodeDef): boolean {
  return node.type === 'agent';
}

function harnessOf(node: NodeDef): string | undefined {
  const harness = typeof node.harness === 'string' ? node.harness.trim() : '';
  return harness === '' || harness.includes('{{') ? undefined : harness;
}

/**
 * The facts a document needs, or null when it names nothing of the
 * organization's — then the host is not asked at all.
 */
export function orgFactsQuery(input: OrgStateInput): OrgFactsQuery | null {
  const agents = input.nodes.filter(isAgent);
  const query: OrgFactsQuery = {
    ...(typeof input.doc.name === 'string' &&
      input.doc.name !== '' && { automation: input.doc.name }),
    skills: agents.some((n) => namedEntries(n.skills).length > 0),
    connectors:
      agents.some((n) => namedEntries(n.connectors).length > 0) ||
      input.nodes.some((n) => capabilityConnector(n) !== undefined),
    secrets: agents.some((n) => namedEntries(n.secrets).length > 0),
    harnesses: agents.some((n) => harnessOf(n) !== undefined),
    event: typeof input.doc.name === 'string' && input.doc.name !== '',
  };
  const asks =
    query.skills ||
    query.connectors ||
    query.secrets ||
    query.harnesses ||
    query.event;
  return asks ? query : null;
}

/** `; did you mean "x"?` for a hint, or nothing. */
function didYouMean(suggestion: string | undefined): string {
  return suggestion === undefined ? '' : `; did you mean "${suggestion}"?`;
}

function skillIssues(
  node: NodeDef,
  base: string,
  skills: ReadonlySet<string>,
): Issue[] {
  return namedEntries(node.skills).flatMap(({ index, name }) => {
    if (skills.has(name)) return [];
    const suggestion = closestName(name, skills);
    return [
      warn(
        'SKILL_UNKNOWN',
        `node "${node.id}": skill "${name}" is not in this organization — the step fails when it runs`,
        {
          nodeId: node.id,
          path: 'skills',
          hint: `list_skills shows the skills an agent step can use${didYouMean(suggestion)}`,
          at: { pointer: `${base}/skills/${index}` },
          params: {
            node: node.id,
            skill: name,
            ...(suggestion !== undefined && { suggestion }),
          },
        },
      ),
    ];
  });
}

function connectorIssue(
  node: NodeDef,
  pointer: string,
  connector: string,
  connectors: NonNullable<OrgFacts['connectors']>,
  path: string,
): Issue | null {
  const catalogued = connectors.catalogued.has(connector);
  if (catalogued) {
    if (!connectors.needsCredential.has(connector)) return null;
    if (connectors.connected.has(connector)) return null;
    return warn(
      'CONNECTOR_NOT_CONNECTED',
      `node "${node.id}": connector "${connector}" is not connected in this organization — a live run cannot reach it`,
      {
        nodeId: node.id,
        path,
        hint: 'list_connectors shows what is connected; a person connects it in Settings › Connectors',
        at: { pointer },
        params: { node: node.id, connector, catalogued: true },
      },
    );
  }
  const suggestion = closestName(connector, connectors.catalogued);
  return warn(
    'CONNECTOR_NOT_CONNECTED',
    `node "${node.id}": connector "${connector}" is not a connector this deployment has`,
    {
      nodeId: node.id,
      path,
      hint: `list_connectors shows the connectors this deployment has${didYouMean(suggestion)}`,
      at: { pointer },
      params: {
        node: node.id,
        connector,
        catalogued: false,
        ...(suggestion !== undefined && { suggestion }),
      },
    },
  );
}

function secretIssues(
  node: NodeDef,
  base: string,
  secrets: ReadonlySet<string>,
): Issue[] {
  return namedEntries(node.secrets).flatMap(({ index, name }) => {
    if (secrets.has(name)) return [];
    const suggestion = closestName(name, secrets);
    return [
      warn(
        'SECRET_UNKNOWN',
        `node "${node.id}": agent secret "${name}" does not exist — the step runs without it`,
        {
          nodeId: node.id,
          path: 'secrets',
          hint: `list_agent_secrets shows the stored names; an owner, admin or developer stores the value under Secrets in this agent step in the editor (or in a project agent's)${didYouMean(suggestion)}`,
          at: { pointer: `${base}/secrets/${index}` },
          params: {
            node: node.id,
            secret: name,
            ...(suggestion !== undefined && { suggestion }),
          },
        },
      ),
    ];
  });
}

function harnessIssue(
  node: NodeDef,
  base: string,
  harnesses: ReadonlySet<string>,
): Issue | null {
  const harness = harnessOf(node);
  if (harness === undefined || harnesses.has(harness)) return null;
  const available = [...harnesses].sort();
  return warn(
    'HARNESS_UNKNOWN',
    `node "${node.id}": agent runtime "${harness}" cannot run on this deployment — the step fails when it runs`,
    {
      nodeId: node.id,
      path: 'harness',
      hint: `list_harnesses shows the ones that can (${available.join(', ')}); leave harness out for the default`,
      at: { pointer: `${base}/harness` },
      params: { node: node.id, harness, available },
    },
  );
}

function eventIssue(bound: OrgFacts['boundEvent']): Issue | null {
  if (bound === undefined || bound === null) return null;
  if (bound.raised.includes(bound.event)) return null;
  const suggestion = closestName(bound.event, bound.raised);
  return warn(
    'EVENT_UNKNOWN',
    `the event trigger waits for "${bound.event}", which Tale does not raise — it never starts a run`,
    {
      hint: `list_events shows the events Tale raises; bind the trigger to one of them${didYouMean(suggestion)}`,
      // The trigger is not part of the document: the finding is about the
      // automation as a whole, so it points at the whole document.
      at: { pointer: '' },
      params: {
        event: bound.event,
        ...(suggestion !== undefined && { suggestion }),
      },
    },
  );
}

/** The org-state warnings of a document, node by node in document order,
 * then the trigger's. */
export function orgStateIssues(input: OrgStateInput, facts: OrgFacts): Issue[] {
  const issues: Issue[] = [];
  for (const node of input.nodes) {
    const base = ptr('nodes', input.indexOf(node));
    if (isAgent(node)) {
      if (facts.harnesses !== undefined) {
        const issue = harnessIssue(node, base, facts.harnesses);
        if (issue !== null) issues.push(issue);
      }
      if (facts.skills !== undefined) {
        issues.push(...skillIssues(node, base, facts.skills));
      }
      if (facts.connectors !== undefined) {
        for (const { index, name } of namedEntries(node.connectors)) {
          const issue = connectorIssue(
            node,
            `${base}/connectors/${index}`,
            name,
            facts.connectors,
            'connectors',
          );
          if (issue !== null) issues.push(issue);
        }
      }
      if (facts.secrets !== undefined) {
        issues.push(...secretIssues(node, base, facts.secrets));
      }
      continue;
    }
    // A capability step's type is a registered action, so its connector is
    // one the host registered; a prefix the catalog does not hold is some
    // other kind of registered type, and says nothing about connections.
    const connector = capabilityConnector(node);
    if (
      connector !== undefined &&
      facts.connectors !== undefined &&
      facts.connectors.catalogued.has(connector)
    ) {
      const issue = connectorIssue(
        node,
        `${base}/type`,
        connector,
        facts.connectors,
        'type',
      );
      if (issue !== null) issues.push(issue);
    }
  }
  const event = eventIssue(facts.boundEvent);
  if (event !== null) issues.push(event);
  return issues;
}
