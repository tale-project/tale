/**
 * Result Processing
 *
 * Handles processing of agent results, extracting steps and tool diagnostics.
 */

import type { ProcessedAgentResult } from '../types';

import { isRecord, getArray } from '../../../../../../lib/utils/type-guards';
import { buildAgentStepsSummary } from './build_agent_steps_summary';
import { extractToolDiagnostics } from './extract_tool_diagnostics';

/**
 * Processes agent result to extract steps and tool diagnostics
 */
export function processAgentResult(result: unknown): ProcessedAgentResult {
  const resultRec = isRecord(result) ? result : undefined;
  const steps = resultRec ? getArray(resultRec, 'steps') : undefined;

  if (!Array.isArray(steps)) {
    return {
      agentSteps: null,
      toolDiagnostics: {
        lastToolName: null,
        lastToolInputText: null,
        lastToolResultText: null,
      },
    };
  }

  // Build compact agent steps summary
  const agentSteps = buildAgentStepsSummary(steps);

  // Extract tool diagnostics
  const toolDiagnostics = extractToolDiagnostics(steps);

  return { agentSteps, toolDiagnostics };
}
