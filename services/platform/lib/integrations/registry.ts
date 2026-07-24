/**
 * Turns the shipped connector catalog into engine node types.
 *
 * Each `configs/platform/system/integrations/<slug>/connector.yml` action
 * becomes one node type named `<connector>.<action>`, so a workflow references
 * it exactly like a built-in: `type: github.create_issue`. The action's JSON
 * Schema drives input validation, its TS-style signature documents the output,
 * and its `effects` decides whether invoking it records an effect and gates
 * behind approvals.
 *
 * Mock bodies run through the engine's CodeRunner rather than being evaluated
 * here — connector bodies are org-visible configuration, so they get the same
 * data-only sandbox as any other untrusted JavaScript, and the authoring loop
 * behaves identically to a live run minus the network.
 *
 * Reading the catalog needs the filesystem, so this module is node-side by
 * design; the engine core stays pure and learns about connectors only through
 * `registerNodeType`.
 */

import { codeRunner } from '../engine/core/runner';
import { registerNodeType, type IntegrationLike } from '../engine/core/slots';
import type {
  IntegrationAction,
  IntegrationConnector,
} from '../shared/schemas/integrations';
import { loadIntegrationConnectors } from './catalog';

/** Mock bodies are pure data reshaping; a generous ceiling still bounds a
 * runaway loop without failing a legitimately large fixture. */
const MOCK_TIMEOUT_MS = 2000;

/** The node type a connector action is addressed by. */
export function nodeTypeFor(connector: string, action: string): string {
  return `${connector}.${action}`;
}

function toIntegration(
  connector: IntegrationConnector,
  action: IntegrationAction,
): IntegrationLike {
  return {
    name: nodeTypeFor(connector.name, action.name),
    description: action.description,
    inputSchema: action.input,
    outputSignature: action.output,
    exampleInput: action.exampleInput,
    hasEffect: action.effects === 'write',
    tags: connector.tags,
    mock: (input) =>
      codeRunner().runBody(
        action.mock,
        { input },
        {
          timeoutMs: MOCK_TIMEOUT_MS,
        },
      ),
  };
}

/** Register every action of one connector. Returns the node type names. */
export function registerConnector(connector: IntegrationConnector): string[] {
  const registered: string[] = [];
  for (const action of connector.actions) {
    const type = nodeTypeFor(connector.name, action.name);
    registerNodeType({
      type,
      kind: 'integration',
      // An action always declares an output signature, so its result is a
      // shape callers may path into.
      outputKind: 'structured',
      description: action.description,
      // Control-flow fields are allowed on every node type; these are the
      // extras an action takes. `credential` names which stored credential to
      // act as, defaulting to the org's default for the connector.
      allowedFields: ['input', 'credential'],
      requiredFields: ['input'],
      integration: toIntegration(connector, action),
    });
    registered.push(type);
  }
  return registered;
}

/**
 * Load every connector under `<systemRoot>/integrations/` and register its
 * actions.
 *
 * A connector whose name disagrees with its directory is refused by the shared
 * reader rather than silently registered under the wrong prefix — the
 * directory is what the settings UI and credential rows key on, so a mismatch
 * would make an action unreachable in one surface and present in another.
 */
export function loadConnectors(systemRoot: string): {
  connectors: IntegrationConnector[];
  nodeTypes: string[];
} {
  const connectors = [...loadIntegrationConnectors({ root: systemRoot })];
  const nodeTypes = connectors.flatMap((connector) =>
    registerConnector(connector),
  );
  return { connectors, nodeTypes };
}
