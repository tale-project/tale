import { AsyncLocalStorage } from 'node:async_hooks';

// A provisioning operation owns one budget across its nested Docker calls.
// Killing a CLI is awaited by runDocker; no uncancelled provisioning race is
// left behind after a create has returned. Cleanup gets an independent budget.
const deadlines = new AsyncLocalStorage<AbortSignal>();

export function dockerDeadlineSignal(): AbortSignal | undefined {
  return deadlines.getStore();
}

export async function withDockerDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  options: { independent?: boolean } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Docker operation deadline exceeded')),
    timeoutMs,
  );
  const parent = options.independent ? undefined : deadlines.getStore();
  const signal = parent
    ? AbortSignal.any([parent, controller.signal])
    : controller.signal;
  try {
    return await deadlines.run(signal, () => operation(signal));
  } finally {
    clearTimeout(timer);
  }
}
