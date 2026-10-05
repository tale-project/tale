import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const repository = fileURLToPath(new URL('../', import.meta.url));
const planSchema = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string().min(1),
      task: z.string().min(1),
      hash: z.string().regex(/^[a-f0-9]{16}$/),
      command: z.string().min(1),
      dependencies: z.array(z.string()),
      cache: z.object({
        local: z.boolean(),
        status: z.enum(['HIT', 'MISS']),
      }),
      resolvedTaskDefinition: z.object({
        cache: z.boolean(),
        persistent: z.boolean(),
      }),
    }),
  ),
});

/** A warm plan saves provisioning, never the actual test command. Unknown
 * plans and executable prerequisites always require the normal toolchain. */
export function requiresTaskProvisioning(
  plan: unknown,
  taskName: string,
  force = false,
): boolean {
  if (force) return true;
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) return true;
  const tasks = new Map(parsed.data.tasks.map((task) => [task.taskId, task]));
  if (tasks.size !== parsed.data.tasks.length) return true;
  if (parsed.data.tasks.some((task) => !task.taskId.endsWith(`#${task.task}`)))
    return true;
  const targets = parsed.data.tasks.filter(
    (task) => task.task === taskName && task.command !== '<NONEXISTENT>',
  );
  if (targets.length === 0) return true;
  const reached = new Set<string>();
  const visiting = new Set<string>();
  const queue = targets.map((task) => ({ id: task.taskId, exit: false }));
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined) continue;
    const { id, exit } = next;
    if (exit) {
      visiting.delete(id);
      reached.add(id);
      continue;
    }
    if (reached.has(id)) continue;
    if (visiting.has(id)) return true;
    const task = tasks.get(id);
    if (!task || task.resolvedTaskDefinition.persistent) return true;
    if (task.command === '<NONEXISTENT>') {
      if (task.task !== 'transit') return true;
    } else if (
      !task.resolvedTaskDefinition.cache ||
      !task.cache.local ||
      task.cache.status !== 'HIT'
    ) {
      return true;
    }
    visiting.add(id);
    queue.push({ id, exit: true });
    queue.push(
      ...task.dependencies.map((dependency) => ({
        id: dependency,
        exit: false,
      })),
    );
  }
  return false;
}

if (import.meta.main) {
  const [taskName, ...unexpected] = process.argv.slice(2);
  let provision = true;
  // Candidates and force requests must provision even if a cache exists.
  if (
    taskName === 'test:browser' &&
    unexpected.length === 0 &&
    process.env.GITHUB_EVENT_NAME !== 'repository_dispatch' &&
    !process.env.TURBO_FORCE
  ) {
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../node_modules/turbo/bin/turbo', import.meta.url),
        ),
        'run',
        taskName,
        '--dry=json',
        '--cache=local:r,remote:',
      ],
      {
        cwd: repository,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (run.status === 0 && !run.error) {
      try {
        provision = requiresTaskProvisioning(JSON.parse(run.stdout), taskName);
      } catch {
        // A changed or truncated Turbo output must retain cold setup.
      }
    }
  }
  console.log(`provision=${provision}`);
  console.error(
    provision
      ? 'Browser prerequisites need provisioning; retain Chromium and native dependencies.'
      : 'Every executable browser prerequisite has a local cached verdict; retain the normal test command.',
  );
}
