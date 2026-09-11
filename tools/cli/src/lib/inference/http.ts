import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { admissionPolicy, INFERENCE_ADMISSION_SHA } from './admission';
import {
  modelIdentity,
  OMLX_RUNTIME,
  type InferenceFetch,
  type InferenceNode,
  type InferenceSpec,
} from './model';

export const inferenceAdmissionSchema = z.object({
  schemaVersion: z.literal(1),
  adapterSha256: z.literal(INFERENCE_ADMISSION_SHA),
  policySha256: z.string(),
  residency: z.literal('evictable-on-demand'),
  maximumConcurrency: z.literal(1),
  queueLimit: z.number().int().nonnegative(),
  ready: z.literal(true),
  phase: z.enum(['idle', 'busy']),
  activeRole: z.string().nullable(),
  queued: z.number().int().nonnegative(),
  preparing: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  maximumObservedActive: z.number().int().min(0).max(1),
  maximumObservedWaiting: z.number().int().nonnegative(),
  models: z
    .array(
      z.object({
        key: z.string(),
        identity: z.string(),
        loaded: z.boolean(),
        loading: z.boolean(),
      }),
    )
    .max(32),
});
export type InferenceAdmission = z.infer<typeof inferenceAdmissionSchema>;

export async function verifyInferenceAdmission(
  spec: InferenceSpec,
  node: InferenceNode,
  key: string,
  fetchImpl: InferenceFetch = fetch,
) {
  const response = await inferenceRequest(
    node,
    '/_tale/admission',
    key,
    fetchImpl,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw preconditionError(
      'Native inference admission is unavailable or held. Inspect its state before restarting the exact service.',
    );
  }
  const parsed = inferenceAdmissionSchema.safeParse(
    await boundedResponse(response),
  );
  const policy = admissionPolicy(spec, node);
  if (!parsed.success)
    throw preconditionError('Native inference admission metadata is invalid.');
  const value = parsed.data;
  if (
    value.policySha256 !== policy.policySha256 ||
    value.queueLimit !== spec.limits.queuedRequests ||
    value.maximumObservedWaiting > value.queueLimit ||
    value.queued + value.preparing + Number(value.phase === 'busy') >
      value.queueLimit + 1 ||
    (value.phase === 'idle') !== (value.activeRole === null) ||
    (value.activeRole !== null && !node.models.includes(value.activeRole)) ||
    value.models.length !== policy.models.length ||
    policy.models.some(
      (model) =>
        value.models.filter(
          (actual) =>
            actual.key === model.key && actual.identity === model.identity,
        ).length !== 1,
    )
  )
    throw preconditionError(
      'Native inference admission policy, role inventory or concurrency differs from the selected release.',
    );
  return value;
}

export async function boundedResponse(
  response: Response,
  limit = 262144,
): Promise<unknown> {
  if (!response.body) throw externalDepError('Inference response has no body.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit)
      throw externalDepError(
        'Inference response exceeds its bounded metadata size.',
      );
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw externalDepError('Inference returned invalid JSON metadata.');
  }
}

export async function inferenceRequest(
  node: InferenceNode,
  path: string,
  key: string | undefined,
  fetchImpl: InferenceFetch = fetch,
  request: { body?: unknown; timeoutMs?: number } = {},
): Promise<Response> {
  try {
    return await fetchImpl(`http://${node.address}:${node.port}${path}`, {
      method: request.body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(request.timeoutMs ?? 10000),
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(request.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    });
  } catch {
    throw externalDepError(
      'The declared private inference endpoint could not be reached without redirects.',
    );
  }
}

export async function verifyInferenceApi(
  spec: InferenceSpec,
  node: InferenceNode,
  serviceKey: string,
  fetchImpl: InferenceFetch = fetch,
) {
  const health = await inferenceRequest(node, '/health', undefined, fetchImpl);
  await health.body?.cancel();
  if (health.status !== 200)
    throw externalDepError(
      'Inference models are still loading or unavailable.',
    );
  const unauthenticated = await inferenceRequest(
    node,
    '/v1/models',
    undefined,
    fetchImpl,
  );
  await unauthenticated.body?.cancel();
  if (unauthenticated.status !== 401)
    throw preconditionError('Inference API authentication is not enforced.');
  const expected = spec.models.filter((model) =>
    node.models.includes(model.key),
  );
  const response = await inferenceRequest(
    node,
    '/api/status',
    serviceKey,
    fetchImpl,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw externalDepError('Inference service has not become healthy.');
  }
  const status = z
    .object({
      status: z.literal('ok'),
      version: z.literal(OMLX_RUNTIME.version),
      loaded_models: z.array(z.string()).max(64),
      models_discovered: z.number().int(),
      models_loaded: z.number().int(),
      models_loading: z.literal(0),
      custom_kernels: z.record(
        z.string(),
        z.object({ available: z.boolean() }),
      ),
    })
    .safeParse(await boundedResponse(response));
  if (
    !status.success ||
    status.data.models_discovered !== expected.length ||
    status.data.models_loaded !== status.data.loaded_models.length ||
    new Set(status.data.loaded_models).size !==
      status.data.loaded_models.length ||
    status.data.loaded_models.some(
      (identity) =>
        !expected.some((model) => modelIdentity(model) === identity),
    ) ||
    expected.some((model) =>
      model.requiredKernels.some(
        (kernel) => !status.data.custom_kernels[kernel]?.available,
      ),
    )
  )
    throw preconditionError(
      'Inference runtime, model inventory or native kernels differ from the selected release.',
    );
  const listed = await inferenceRequest(
    node,
    '/v1/models',
    serviceKey,
    fetchImpl,
  );
  if (!listed.ok) {
    await listed.body?.cancel();
    throw externalDepError('Inference model catalog is unavailable.');
  }
  const catalog = z
    .object({
      data: z
        .array(z.object({ id: z.string(), max_model_len: z.number().int() }))
        .max(64),
    })
    .safeParse(await boundedResponse(listed));
  if (
    !catalog.success ||
    catalog.data.data.length !== expected.length ||
    expected.some(
      (model) =>
        catalog.data.data.filter(
          (entry) =>
            entry.id === model.apiModel &&
            entry.max_model_len === model.contextTokens,
        ).length !== 1,
    )
  )
    throw preconditionError(
      'Inference API model names or context limits differ from the selected release.',
    );
  const admission = await verifyInferenceAdmission(
    spec,
    node,
    serviceKey,
    fetchImpl,
  );
  if (
    JSON.stringify(
      admission.models
        .filter((model) => model.loaded)
        .map((model) => model.identity)
        .sort(),
    ) !== JSON.stringify([...status.data.loaded_models].sort())
  )
    throw preconditionError(
      'Inference loaded-model snapshot changed during verification. Observe the node again when settled.',
    );
  return {
    authenticated: true as const,
    models: expected.map((model) => ({
      key: model.key,
      apiModel: model.apiModel,
      identity: modelIdentity(model),
      capability: model.capability,
    })),
    runtimeVersion: status.data.version,
    admission,
  };
}

/** The pinned public status omits embedding work. Its supported admin activity
 * endpoint includes non-streaming engines. This is an observation after the
 * operator drains routing, not a lock against new requests on another host. */
export async function requireIdleInference(
  node: InferenceNode,
  adminKey: string,
  fetchImpl: InferenceFetch = fetch,
): Promise<void> {
  const login = await inferenceRequest(
    node,
    '/admin/api/login',
    undefined,
    fetchImpl,
    {
      body: { api_key: adminKey, remember: false },
    },
  );
  if (!login.ok) {
    await login.body?.cancel();
    throw preconditionError(
      'Inference administrator authentication could not prove current activity. Activation is held.',
    );
  }
  const cookies = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0] ?? '')
    .filter((value) => value.startsWith('omlx_admin_session='));
  const cookie = cookies[0];
  if (
    cookies.length !== 1 ||
    !cookie ||
    !/^omlx_admin_session=[A-Za-z0-9_.-]{1,8192}$/.test(cookie)
  ) {
    await login.body?.cancel();
    throw preconditionError(
      'Inference administrator login returned an invalid session. Activation is held.',
    );
  }
  const request = async (path: '/admin/api/activity' | '/admin/api/logout') => {
    try {
      return await fetchImpl(`http://${node.address}:${node.port}${path}`, {
        method: path.endsWith('/logout') ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { cookie, accept: 'application/json' },
      });
    } catch {
      throw externalDepError(
        'Inference administrator activity could not be verified without redirects. Activation is held.',
      );
    }
  };
  let logoutFailed = false;
  try {
    const authenticated = z
      .object({ success: z.literal(true) })
      .safeParse(await boundedResponse(login));
    if (!authenticated.success)
      throw preconditionError(
        'Inference administrator login was not confirmed. Activation is held.',
      );
    const response = await request('/admin/api/activity');
    if (!response.ok) {
      await response.body?.cancel();
      throw preconditionError(
        'Existing inference activity is unavailable. Remove the node from routing and inspect it before activation.',
      );
    }
    const activity = z
      .object({
        active_models: z.object({
          total_active_requests: z.literal(0),
          total_waiting_requests: z.literal(0),
        }),
      })
      .safeParse(await boundedResponse(response));
    if (!activity.success)
      throw preconditionError(
        'Inference has active or queued requests. Remove this node from routing and let them finish before activation.',
      );
  } finally {
    try {
      const logout = await request('/admin/api/logout');
      await logout.body?.cancel();
      logoutFailed = !logout.ok;
    } catch {
      logoutFailed = true;
    }
  }
  if (logoutFailed)
    throw externalDepError(
      'Inference administrator logout could not be confirmed. Activation is held.',
    );
}
