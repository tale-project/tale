/**
 * Thin wrapper around a single Prism mock instance built from one OpenAPI spec.
 *
 * Prism's public `request()` returns an fp-ts `TaskEither` (a `() => Promise<Either>`
 * thunk); this wrapper invokes it, unwraps the `Either`, and exposes a plain
 * `respond()` returning the negotiated status / headers / body. Each instance is
 * built once at boot (`getHttpOperationsFromSpec` parses the YAML/JSON spec) and
 * reused per request, so spec parsing never happens on the hot path.
 *
 * Determinism: instances run with `mock.dynamic = false`, so Prism returns the
 * single canonical `example` declared on each response instead of schema-generated
 * fakes — identical bytes across runs, which the e2e/contract assertions rely on.
 */

import { createLogger } from '@stoplight/prism-core';
import {
  createInstance,
  getHttpOperationsFromSpec,
} from '@stoplight/prism-http';
import type { IHttpConfig } from '@stoplight/prism-http';
import type { HttpMethod } from '@stoplight/types';

/** The subset of Prism's negotiated response the gateway forwards. */
export interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

interface MockRequestInput {
  method: string;
  path: string;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
  body?: unknown;
  /** Force a specific response status (from a `Prefer: code=NNN` header). */
  forceStatus?: number;
}

// fp-ts `Either` is structural; we read only the discriminant + payload, so a
// minimal local shape avoids taking a direct dependency on fp-ts.
interface Either<L, R> {
  readonly _tag: 'Left' | 'Right';
  readonly left?: L;
  readonly right?: R;
}

interface PrismOutput {
  output?: {
    statusCode?: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
}

// Prism's `IHttpOperation[]` and `IPrism` are richly typed; we only need to hold
// and forward them, so they are kept opaque here.
type HttpOperations = Awaited<ReturnType<typeof getHttpOperationsFromSpec>>;
type PrismHttp = ReturnType<typeof createInstance>;

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
] as const;

/** Validate + lowercase an HTTP method into Prism's `HttpMethod` union. */
function toHttpMethod(method: string): HttpMethod {
  const lower = method.toLowerCase();
  const match = HTTP_METHODS.find((candidate) => candidate === lower);
  if (!match) throw new Error(`[mocks] unsupported HTTP method: ${method}`);
  return match;
}

export class MockInstance {
  private constructor(
    readonly name: string,
    private readonly operations: HttpOperations,
    private readonly prism: PrismHttp,
    private readonly baseConfig: IHttpConfig,
  ) {}

  static async fromSpec(
    name: string,
    specPath: string,
    options: { validateRequest?: boolean } = {},
  ): Promise<MockInstance> {
    const operations = await getHttpOperationsFromSpec(specPath);
    if (operations.length === 0) {
      throw new Error(
        `[mocks] spec "${name}" (${specPath}) defines no operations`,
      );
    }
    const logger = createLogger('mocks', { level: 'silent' });
    const config: IHttpConfig = {
      mock: { dynamic: false },
      // The gateway serves the app/e2e leniently (always return the example);
      // contract tests opt into strict request validation to catch a connector
      // sending the wrong shape. Default strict.
      validateRequest: options.validateRequest ?? true,
      // Response validation stays on: a spec example that violates its own
      // schema fails loudly at request time — the contract guard.
      validateResponse: true,
      checkSecurity: false,
      errors: false,
      // Mock (not proxy) mode — no upstream forwarding.
      isProxy: false,
      upstreamProxy: undefined,
    };
    const prism = createInstance(config, { logger });
    return new MockInstance(name, operations, prism, config);
  }

  /** Number of operations this instance serves (for boot diagnostics). */
  get operationCount(): number {
    return this.operations.length;
  }

  async respond(input: MockRequestInput): Promise<MockResponse> {
    const task = this.prism.request(
      {
        method: toHttpMethod(input.method),
        url: { path: input.path, query: input.query },
        headers: input.headers ?? {},
        body: input.body,
      },
      this.operations,
      input.forceStatus !== undefined
        ? {
            ...this.baseConfig,
            mock: { dynamic: false, code: input.forceStatus },
          }
        : undefined,
    );
    const either = (await task()) as Either<Error, PrismOutput>;
    if (either._tag === 'Left' || !either.right) {
      throw (
        either.left ?? new Error(`[mocks] ${this.name}: empty Prism result`)
      );
    }
    const out = either.right.output ?? {};
    return {
      statusCode: out.statusCode ?? 200,
      headers: out.headers ?? {},
      body: out.body,
    };
  }
}
