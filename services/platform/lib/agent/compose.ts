/**
 * One tool executor from several.
 *
 * A turn's tools come from separate executors — the retrieval tools, the
 * work tools, a lane's own (a task's) — each owning its names and its
 * context. The turn pipeline takes ONE executor, so this joins them: the
 * wire definitions in the order given, and each call dispatched to the
 * executor that offered its name.
 *
 * Two executors offering the same name is a packaging defect, refused at
 * construction: the model's call would be ambiguous, and quietly letting the
 * first one win hides which implementation actually ran. A call naming a
 * tool nobody offered answers a structured error, as every executor must
 * never throw.
 *
 * Layer A: pure.
 */

import type {
  ChatToolExecutor,
  ToolCallOptions,
  ToolCallRequest,
} from '../chat/tools';

export function composeToolExecutors(
  executors: readonly (ChatToolExecutor | undefined)[],
): ChatToolExecutor | undefined {
  const present = executors.filter(
    (executor): executor is ChatToolExecutor => executor !== undefined,
  );
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  const owner = new Map<string, ChatToolExecutor>();
  for (const executor of present) {
    for (const tool of executor.wireTools) {
      if (owner.has(tool.name)) {
        throw new Error(
          `[agent] tool "${tool.name}" is offered by two executors of one turn`,
        );
      }
      owner.set(tool.name, executor);
    }
  }
  return {
    wireTools: present.flatMap((executor) => executor.wireTools),
    execute(
      call: ToolCallRequest,
      options?: ToolCallOptions,
    ): Promise<unknown> {
      const executor = owner.get(call.name);
      if (executor === undefined) {
        return Promise.resolve({
          status: 'error',
          message: `There is no tool named "${call.name}". Use one of: ${[...owner.keys()].join(', ')}.`,
        });
      }
      return executor.execute(call, options);
    },
  };
}
