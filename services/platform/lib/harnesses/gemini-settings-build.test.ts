import { describe, expect, it } from 'vitest';

import {
  geminiPolicies,
  GEMINI_BRIDGE_URL,
  GEMINI_CONTEXT_FILE,
} from '../../../sandbox-runtime/build-gemini-settings';
import { loadHarnesses } from '../../backend/core/lib/providers/load_system_config';
import { buildHarnessExec } from './exec-builder';
import { batteryFor } from './test-helpers';

describe('Gemini image policy coverage', () => {
  const fact = loadHarnesses().find((entry) => entry.slug === 'gemini')!;
  const policies = [...geminiPolicies(fact).values()];
  it.each(batteryFor(fact))(
    'covers the complete settings of $name',
    ({ spec }) => {
      const envelope = JSON.parse(buildHarnessExec(fact, spec).stdin!);
      const settings = envelope.settings;
      if (settings.mcpServers?.connectors) {
        settings.mcpServers.connectors.env.TALE_CONNECTORS_URL =
          GEMINI_BRIDGE_URL;
      }
      expect(policies).toContainEqual({
        ...settings,
        context: { fileName: ['GEMINI.md', GEMINI_CONTEXT_FILE] },
      });
    },
  );
});
