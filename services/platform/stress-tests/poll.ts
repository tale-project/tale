/**
 * Execution polling via `npx convex run`
 *
 * ConvexHttpClient cannot call internalQuery functions.
 * This helper shells out to `npx convex run` which can.
 *
 * Supports remote deployments via CONVEX_URL env var — pass --url
 * so polling targets the same backend as the ConvexHttpClient.
 */

import { execFileSync } from 'child_process';

interface ExecutionStatus {
  status: string;
  error?: string;
}

function buildConvexRunArgs(functionName: string, fnArgs: string): string[] {
  const args = ['convex', 'run', functionName, fnArgs];
  const url = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (url) {
    args.push('--url', url);
  }
  return args;
}

export function pollExecutionViaConvexRun(
  executionId: string,
): ExecutionStatus {
  try {
    const output = execFileSync(
      'npx',
      buildConvexRunArgs(
        'wf_executions/queries:getRawExecution',
        JSON.stringify({ executionId }),
      ),
      {
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const parsed = JSON.parse(output.trim());
    if (!parsed) {
      return { status: 'failed', error: 'Execution not found' };
    }

    const metadata = parsed.metadata ? JSON.parse(parsed.metadata) : {};

    return {
      status: parsed.status,
      error: metadata.error,
    };
  } catch {
    return { status: 'unknown' };
  }
}

export function pollExecutionBatchViaConvexRun(
  executionIds: string[],
): Map<string, ExecutionStatus> {
  const results = new Map<string, ExecutionStatus>();

  for (const id of executionIds) {
    results.set(id, pollExecutionViaConvexRun(id));
  }

  return results;
}
