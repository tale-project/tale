/**
 * Thin client for the Tale runtime REST surface. Bearer-key auth; every
 * call is bounded by a timeout and returns typed-ish JSON (the server owns
 * validation). 401s surface as `ApiAuthError` so the loop can stop with a
 * clear "rotate your key" message instead of hammering the endpoint.
 */

import type { AdapterDetection } from './adapters/types.ts';
import type { DaemonConfig } from './config.ts';

export class ApiAuthError extends Error {}

export interface ClaimedWork {
  externalRunId: string;
  taskId: string;
  agentSlug: string;
  adapterType: string;
  permissionMode: 'safe' | 'auto_edits' | 'full_auto';
  workspaceKey?: string;
  kind: 'initial' | 'revision';
  resumeSessionRef?: string;
  prompt: string;
  timeoutMs: number;
}

export class TaleApi {
  constructor(private readonly config: DaemonConfig) {
    if (!config.apiKey) {
      throw new ApiAuthError(
        'No API key configured — run `tale-daemon setup` or set TALE_DAEMON_API_KEY.',
      );
    }
  }

  private async post(
    pathname: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.config.baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401) {
      throw new ApiAuthError('API key rejected (401) — rotate the key.');
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '30');
      throw new RateLimitedError(retryAfter * 1000);
    }
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof json === 'object' && json !== null && 'error' in json
          ? String((json as { error: unknown }).error)
          : `HTTP ${response.status}`;
      throw new Error(`${pathname} failed: ${message}`);
    }
    return typeof json === 'object' && json !== null
      ? (json as Record<string, unknown>)
      : {};
  }

  async register(args: {
    adapters: AdapterDetection[];
    workspaceKeys: string[];
  }): Promise<void> {
    await this.post('/api/v1/runtimes/register', {
      daemonId: this.config.daemonId,
      name: this.config.name,
      adapters: args.adapters,
      workspaceKeys: args.workspaceKeys,
    });
  }

  async heartbeat(): Promise<{ cancel: string[] }> {
    const result = await this.post('/api/v1/runtimes/heartbeat', {
      daemonId: this.config.daemonId,
    });
    const cancel = Array.isArray(result.cancel)
      ? result.cancel.filter((id): id is string => typeof id === 'string')
      : [];
    return { cancel };
  }

  async claim(
    adapterTypes: string[],
  ): Promise<{ run: ClaimedWork | null; retryAfterMs: number }> {
    const result = await this.post('/api/v1/runs/claim', {
      daemonId: this.config.daemonId,
      adapterTypes,
    });
    const retryAfterMs =
      typeof result.retryAfterMs === 'number' ? result.retryAfterMs : 15_000;
    const run =
      typeof result.run === 'object' && result.run !== null
        ? (result.run as unknown as ClaimedWork)
        : null;
    return { run, retryAfterMs };
  }

  async sendEvent(
    externalRunId: string,
    type: 'started' | 'progress' | 'heartbeat',
    message?: string,
  ): Promise<{ cancelRequested: boolean }> {
    const result = await this.post(`/api/v1/runs/${externalRunId}/events`, {
      daemonId: this.config.daemonId,
      type,
      message,
    });
    return { cancelRequested: result.cancelRequested === true };
  }

  async complete(
    externalRunId: string,
    args: {
      summary: string;
      diffStat?: string;
      sessionRef?: string;
      inputTokens?: number;
      outputTokens?: number;
      costCents?: number;
    },
  ): Promise<void> {
    await this.post(`/api/v1/runs/${externalRunId}/complete`, {
      daemonId: this.config.daemonId,
      summary: args.summary,
      diffStat: args.diffStat,
      sessionRef: args.sessionRef,
      usage: {
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        costCents: args.costCents,
      },
    });
  }

  async fail(
    externalRunId: string,
    error: string,
    retryable: boolean,
  ): Promise<void> {
    await this.post(`/api/v1/runs/${externalRunId}/fail`, {
      daemonId: this.config.daemonId,
      error,
      retryable,
    });
  }
}

export class RateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Rate limited; retry in ${retryAfterMs}ms`);
  }
}
