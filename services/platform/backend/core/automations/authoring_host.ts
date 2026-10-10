'use node';

import { installConnectorCatalog } from '../../../lib/connectors/dispatcher';
import { registerConnector } from '../../../lib/connectors/registry';
import { installCodeRunner } from '../../lib/code-runner.ts';
import { loadConnectorDefinitions } from '../connector_credentials/connector_catalog';

/** Install the engine seams for App save/deploy validation and acceptance
 * tests. Runs use deterministic mocks; this does not enable live execution.
 * Connector reads are memoized behind each file's stat. */
export function assembleAutomationAuthoringHost(): void {
  installCodeRunner();
  const connectors = loadConnectorDefinitions();
  installConnectorCatalog(connectors);
  for (const connector of connectors) registerConnector(connector);
}
