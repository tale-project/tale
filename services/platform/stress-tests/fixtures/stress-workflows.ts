/**
 * Stress test configuration presets
 *
 * Each preset defines parameters tuned for a specific stress pattern.
 * The actual workflow definition must exist in the Convex database —
 * pass its ID via WORKFLOW_DEFINITION_ID or --workflow.
 */

export interface StressScenarioConfig {
  name: string;
  description: string;
  concurrency: number;
  total: number;
  rampUpSeconds: number;
  pollIntervalMs: number;
  stuckThresholdMs: number;
  inputOverrides?: Record<string, unknown>;
}

export const scenarios: Record<string, StressScenarioConfig> = {
  rapid_fire: {
    name: 'Rapid Fire',
    description:
      'Maximum concurrent starts — smoke-tests that the engine handles parallel launches without functional failures',
    concurrency: 50,
    total: 50,
    rampUpSeconds: 0,
    pollIntervalMs: 2000,
    stuckThresholdMs: 5 * 60 * 1000,
  },

  sustained_load: {
    name: 'Sustained Load',
    description:
      'Steady stream of workflows over 5 minutes — verifies the engine stays functional under sustained load',
    concurrency: 5,
    total: 150,
    rampUpSeconds: 300,
    pollIntervalMs: 3000,
    stuckThresholdMs: 10 * 60 * 1000,
  },

  heavy_payload: {
    name: 'Heavy Payload',
    description:
      'Workflows with large variable payloads — tests serialization and storage spill',
    concurrency: 10,
    total: 10,
    rampUpSeconds: 0,
    pollIntervalMs: 3000,
    stuckThresholdMs: 8 * 60 * 1000,
    inputOverrides: {
      largePayload: true,
      payloadSizeKb: 500,
      paddingData: 'x'.repeat(1024),
    },
  },

  loop_contention: {
    name: 'Loop Contention',
    description:
      'Concurrent workflows with many loop iterations — verifies loop state management under load',
    concurrency: 10,
    total: 10,
    rampUpSeconds: 0,
    pollIntervalMs: 5000,
    stuckThresholdMs: 15 * 60 * 1000,
    inputOverrides: {
      loopIterations: 50,
    },
  },

  scheduler_overlap: {
    name: 'Scheduler Overlap',
    description:
      '6 workflows in rapid sequence — verifies sequential starts complete without functional errors',
    concurrency: 6,
    total: 6,
    rampUpSeconds: 0,
    pollIntervalMs: 2000,
    stuckThresholdMs: 5 * 60 * 1000,
  },
};
