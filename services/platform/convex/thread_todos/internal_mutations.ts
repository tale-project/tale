import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import {
  deriveActiveTodoId,
  OP_ID_RING_BUFFER_SIZE,
  type TodoItem,
} from './helpers';
import { todoStatusValidator } from './schema';

const addOperationValidator = v.object({
  type: v.literal('add'),
  id: v.string(),
  content: v.string(),
});

const updateOperationValidator = v.object({
  type: v.literal('update'),
  id: v.string(),
  content: v.optional(v.string()),
  status: v.optional(todoStatusValidator),
  findingsSummary: v.optional(v.string()),
  failureReason: v.optional(v.string()),
});

const removeOperationValidator = v.object({
  type: v.literal('remove'),
  id: v.string(),
});

const operationValidator = v.union(
  addOperationValidator,
  updateOperationValidator,
  removeOperationValidator,
);

type UpdateTodosResult =
  | {
      success: true;
      todos: TodoItem[];
      activeTodoId?: string;
      deduplicated?: boolean;
    }
  | {
      success: false;
      error: string;
      code:
        | 'duplicate_active'
        | 'unknown_todo'
        | 'duplicate_add'
        | 'invalid_batch';
    };

export const applyTodoOperations = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    opId: v.string(),
    operations: v.array(operationValidator),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      todos: v.array(
        v.object({
          id: v.string(),
          content: v.string(),
          status: todoStatusValidator,
          searchCount: v.number(),
          extractCount: v.number(),
          findingsSummary: v.optional(v.string()),
          failureReason: v.optional(v.string()),
          createdAt: v.number(),
          updatedAt: v.number(),
        }),
      ),
      activeTodoId: v.optional(v.string()),
      deduplicated: v.optional(v.boolean()),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      code: v.union(
        v.literal('duplicate_active'),
        v.literal('unknown_todo'),
        v.literal('duplicate_add'),
        v.literal('invalid_batch'),
      ),
    }),
  ),
  handler: async (ctx, args): Promise<UpdateTodosResult> => {
    const now = Date.now();
    const existing = await ctx.db
      .query('threadTodos')
      .withIndex('by_org_thread', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('threadId', args.threadId),
      )
      .first();

    // Idempotency guard — duplicate opId is a no-op, return current state.
    if (existing && existing.recentOpIds.includes(args.opId)) {
      return {
        success: true,
        todos: existing.todos,
        activeTodoId: existing.activeTodoId,
        deduplicated: true,
      };
    }

    if (args.operations.length === 0) {
      return {
        success: false,
        error: 'operations array must be non-empty',
        code: 'invalid_batch',
      };
    }

    const todosMap = new Map<string, TodoItem>();
    if (existing) {
      for (const todo of existing.todos) {
        todosMap.set(todo.id, todo);
      }
    }

    for (const op of args.operations) {
      if (op.type === 'add') {
        if (todosMap.has(op.id)) {
          return {
            success: false,
            error: `todo id "${op.id}" already exists; use update or remove`,
            code: 'duplicate_add',
          };
        }
        todosMap.set(op.id, {
          id: op.id,
          content: op.content,
          status: 'pending',
          searchCount: 0,
          extractCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      } else if (op.type === 'update') {
        const current = todosMap.get(op.id);
        if (!current) {
          return {
            success: false,
            error: `todo "${op.id}" not found`,
            code: 'unknown_todo',
          };
        }
        const next: TodoItem = {
          ...current,
          updatedAt: now,
        };
        if (op.content !== undefined) next.content = op.content;
        if (op.status !== undefined) next.status = op.status;
        if (op.findingsSummary !== undefined) {
          next.findingsSummary = op.findingsSummary;
        }
        if (op.failureReason !== undefined) {
          next.failureReason = op.failureReason;
        }
        todosMap.set(op.id, next);
      } else if (op.type === 'remove') {
        todosMap.delete(op.id);
      }
    }

    const nextTodos = Array.from(todosMap.values()).sort(
      (a, b) => a.createdAt - b.createdAt,
    );

    // Single-active-todo invariant evaluated on post-state of the full batch.
    const inProgress = nextTodos.filter((t) => t.status === 'in_progress');
    if (inProgress.length > 1) {
      const ids = inProgress.map((t) => t.id).join(', ');
      return {
        success: false,
        error: `only one todo can be in_progress at a time; got ${inProgress.length} (${ids}). Mark the previous one done or pending first.`,
        code: 'duplicate_active',
      };
    }

    const activeTodoId = deriveActiveTodoId(nextTodos);

    const nextRecentOpIds = trimRingBuffer(
      existing?.recentOpIds ?? [],
      args.opId,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        todos: nextTodos,
        activeTodoId,
        recentOpIds: nextRecentOpIds,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('threadTodos', {
        organizationId: args.organizationId,
        threadId: args.threadId,
        todos: nextTodos,
        activeTodoId,
        recentOpIds: nextRecentOpIds,
        integrationCallCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true, todos: nextTodos, activeTodoId };
  },
});

export const incrementIntegrationCallCount = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    delta: v.number(),
    todoId: v.optional(v.string()),
    counterKind: v.optional(v.union(v.literal('search'), v.literal('extract'))),
  },
  returns: v.object({
    integrationCallCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('threadTodos')
      .withIndex('by_org_thread', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('threadId', args.threadId),
      )
      .first();
    const now = Date.now();

    if (!existing) {
      // Create a skeleton record so counts persist even when the agent has not
      // called update_todos yet (rare — but keeps accounting honest).
      const inserted = await ctx.db.insert('threadTodos', {
        organizationId: args.organizationId,
        threadId: args.threadId,
        todos: [],
        activeTodoId: undefined,
        recentOpIds: [],
        integrationCallCount: Math.max(0, args.delta),
        createdAt: now,
        updatedAt: now,
      });
      const row = await ctx.db.get(inserted);
      return { integrationCallCount: row?.integrationCallCount ?? args.delta };
    }

    let nextTodos = existing.todos;
    if (args.todoId && args.counterKind) {
      nextTodos = existing.todos.map((todo) => {
        if (todo.id !== args.todoId) return todo;
        if (args.counterKind === 'search') {
          return { ...todo, searchCount: todo.searchCount + args.delta };
        }
        return { ...todo, extractCount: todo.extractCount + args.delta };
      });
    }

    const nextCount = existing.integrationCallCount + args.delta;
    await ctx.db.patch(existing._id, {
      integrationCallCount: nextCount,
      todos: nextTodos,
      updatedAt: now,
    });
    return { integrationCallCount: nextCount };
  },
});

function trimRingBuffer(buffer: string[], nextOpId: string): string[] {
  const filtered = buffer.filter((id) => id !== nextOpId);
  filtered.push(nextOpId);
  if (filtered.length <= OP_ID_RING_BUFFER_SIZE) {
    return filtered;
  }
  return filtered.slice(filtered.length - OP_ID_RING_BUFFER_SIZE);
}
