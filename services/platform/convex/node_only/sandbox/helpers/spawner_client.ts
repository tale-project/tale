'use node';

// HTTP client for the sandbox spawner.
//
// HMAC-signs each request body with SANDBOX_TOKEN (mirrors services/sandbox/
// src/auth.ts). Spawner rejects unsigned or wrong-signed requests with 401.

import { createHmac } from 'node:crypto';

const SIGNATURE_HEADER = 'x-tale-sandbox-signature';

export interface SpawnerExecuteBody {
  executionId: string;
  organizationId: string;
  language: 'python' | 'node';
  code: string;
  packages?: string[];
  inputFiles?: { name: string; contentBase64: string }[];
  timeoutMs?: number;
  options?: { allowSdist?: boolean; allowInstallScripts?: boolean };
}

export type SpawnerErrorCode =
  | 'TIMEOUT'
  | 'OOM'
  | 'EGRESS_DENIED'
  | 'INSTALL_FAILED'
  | 'PACKAGE_NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'RUNTIME_ERROR'
  | 'SPAWNER_UNAVAILABLE'
  | 'CANCELLED';

export interface SpawnerExecuteResponse {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  errorCode?: SpawnerErrorCode;
  errorMessage?: string;
  stdoutBase64: string;
  stderrBase64: string;
  durationMs: number;
  installMs: number | null;
  runMs: number | null;
  truncated: { stdout: boolean; stderr: boolean; files: number };
  outputFiles: {
    name: string;
    contentBase64: string;
    size: number;
    contentType: string;
  }[];
}

function sign(body: string, token: string): string {
  return createHmac('sha256', token).update(body).digest('hex');
}

function getSpawnerUrl(): string {
  return process.env.SANDBOX_URL ?? 'http://sandbox:8003';
}

function getSpawnerToken(): string {
  const token = process.env.SANDBOX_TOKEN;
  if (!token) {
    throw new Error(
      'SANDBOX_TOKEN env var is required for sandbox/code_run; set it in .env',
    );
  }
  return token;
}

/**
 * POST /v1/execute. Throws on transport / 5xx / 401; returns the spawner's
 * own success-shape `{status, errorCode, ...}` otherwise so the caller can
 * decide failure semantics.
 */
export async function spawnerExecute(
  body: SpawnerExecuteBody,
  signal: AbortSignal,
): Promise<SpawnerExecuteResponse> {
  const url = `${getSpawnerUrl()}/v1/execute`;
  const token = getSpawnerToken();
  const bodyJson = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: sign(bodyJson, token),
      },
      body: bodyJson,
      signal,
    });
  } catch (err) {
    throw new Error(
      `sandbox spawner unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status === 401) {
    throw new Error(
      'sandbox spawner rejected request (401) — SANDBOX_TOKEN mismatch between Convex and spawner',
    );
  }
  if (res.status === 429) {
    throw new Error('sandbox spawner busy (429) — concurrency cap reached');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`sandbox spawner ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as SpawnerExecuteResponse;
}

export async function spawnerCancel(executionId: string): Promise<void> {
  const url = `${getSpawnerUrl()}/v1/cancel/${encodeURIComponent(executionId)}`;
  const token = getSpawnerToken();
  const body = '';
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: sign(body, token),
      },
      body,
    });
  } catch {
    // Cancellation is best-effort; the watchdog cron will reap stuck rows.
  }
}
