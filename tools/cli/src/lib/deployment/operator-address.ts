import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import {
  identifier,
  withBackendAuth,
  type BackendAdapterOptions,
} from './native-client';

export interface OperatorAddressInput {
  userId: string;
  /** The declared sign-in address. */
  email: string;
  /** The retained account's previous sign-in address. */
  migrateEmailFrom: string;
}
export interface OperatorAddress {
  /** The retained account's current address: the declared or the previous one. */
  read: (input: OperatorAddressInput) => Promise<{ email: string }>;
  /** Move the authenticated retained account from its previous address to the
   * declared one, then end every session it holds. Replays without a rename. */
  rename: (
    input: OperatorAddressInput & { headers: Headers },
  ) => Promise<{ renamed: boolean }>;
}

type AsyncCall = (...args: never[]) => Promise<unknown>;
const callable = z.custom<AsyncCall>((value) => typeof value === 'function');
const inputSchema = z.object({
  userId: identifier,
  email: z.email().max(254),
  migrateEmailFrom: z.email().max(254),
});
const contextSchema = z.object({
  internalAdapter: z.object({
    findUserById: callable,
    findUserByEmail: callable,
    updateUser: callable,
    deleteUserSessions: callable,
    listSessions: callable,
  }),
  adapter: z.object({ update: callable }).passthrough(),
});
const userSchema = z.object({ id: identifier, email: z.email() });

function selectInput(input: OperatorAddressInput) {
  const selected = inputSchema.safeParse(input);
  const declared = selected.data?.email.toLowerCase();
  const previous = selected.data?.migrateEmailFrom.toLowerCase();
  if (!selected.success || !declared || !previous || declared === previous)
    throw preconditionError('Invalid operator address migration input.');
  return { userId: selected.data.userId, declared, previous };
}

/** Backend-local reads and one guarded native write through Better Auth's own
 * internal adapter: no public route, raw SQL or plaintext credential. Account
 * IDs, and everything keyed by them, stay untouched. */
export function createBackendOperatorAddress(
  options: BackendAdapterOptions,
): OperatorAddress {
  async function current(
    context: z.infer<typeof contextSchema>,
    selected: ReturnType<typeof selectInput>,
  ): Promise<{ email: string } | { refusal: string }> {
    const found = z
      .nullable(userSchema)
      .parse(
        await context.internalAdapter.findUserById(selected.userId as never),
      );
    if (!found)
      return {
        refusal:
          'The retained operator account is missing; no replacement was created.',
      };
    if (found.id !== selected.userId)
      throw new Error('Native account lookup differs');
    const email = found.email.toLowerCase();
    if (email !== selected.declared && email !== selected.previous)
      return {
        refusal:
          'The retained operator account holds neither the declared nor the previous address.',
      };
    const holder = z
      .object({ user: userSchema })
      .nullable()
      .parse(
        await context.internalAdapter.findUserByEmail(
          selected.declared as never,
        ),
      );
    if (holder && holder.user.id !== selected.userId)
      return {
        refusal: 'Another account already holds the declared operator address.',
      };
    return { email };
  }

  return {
    read: async (input) => {
      const selected = selectInput(input);
      let outcome: { email: string } | { refusal: string } | undefined;
      try {
        await withBackendAuth(options, async (auth) => {
          outcome = await current(
            contextSchema.parse(await auth.$context),
            selected,
          );
        });
      } catch {
        throw externalDepError('Native operator address lookup failed.');
      }
      if (outcome && 'refusal' in outcome)
        throw preconditionError(outcome.refusal);
      if (!outcome)
        throw externalDepError('Native operator address lookup failed.');
      return { email: outcome.email };
    },
    rename: async (input) => {
      const selected = selectInput(input);
      if (!(input.headers instanceof Headers))
        throw preconditionError('Invalid operator address migration input.');
      let refusal: string | undefined;
      let renamed: boolean | undefined;
      try {
        await withBackendAuth(options, async (auth) => {
          const native = z.object({ getSession: callable }).parse(auth.api);
          const rawContext = await auth.$context;
          const context = contextSchema.parse(rawContext);
          const session = z
            .object({
              user: userSchema,
              session: z.object({ userId: identifier }),
            })
            .parse(
              await native.getSession({
                headers: input.headers,
                query: { disableCookieCache: true, disableRefresh: true },
              } as never),
            );
          if (
            session.user.id !== selected.userId ||
            session.session.userId !== selected.userId
          )
            throw new Error('Authenticated session differs');
          const before = await current(context, selected);
          if ('refusal' in before) {
            refusal = before.refusal;
            return;
          }
          let writes = 0;
          if (before.email === selected.previous) {
            const load =
              options.loadModule ??
              (async (id) => import(id) as Promise<unknown>);
            const scope = z
              .object({ runWithAdapter: callable, getCurrentAdapter: callable })
              .parse(
                await load(
                  '/app/node_modules/@better-auth/core/dist/context/index.mjs',
                ),
              );
            // The native update keeps its hooks and session-cache refresh; the
            // scoped adapter only admits this exact write, guarded by the
            // previous address so a concurrent change cannot be overwritten.
            const adapter = (
              rawContext as {
                adapter: Record<string, unknown> & { update: AsyncCall };
              }
            ).adapter;
            const scoped = {
              ...adapter,
              update: async (value: unknown) => {
                const request = z
                  .strictObject({
                    model: z.literal('user'),
                    update: z.strictObject({
                      email: z.literal(selected.declared),
                      // The previous address's verification says nothing
                      // about the declared one, as for a native address change.
                      emailVerified: z.literal(false),
                    }),
                    where: z.tuple([
                      z.strictObject({
                        field: z.literal('id'),
                        value: z.literal(selected.userId),
                      }),
                    ]),
                  })
                  .parse(value);
                if (writes !== 0)
                  throw new Error('Duplicate native address write');
                const result = await adapter.update({
                  ...request,
                  where: [
                    ...request.where,
                    {
                      field: 'email',
                      value: selected.previous,
                      connector: 'AND',
                    },
                  ],
                } as never);
                const updated = userSchema.parse(result);
                if (
                  updated.id !== selected.userId ||
                  updated.email.toLowerCase() !== selected.declared
                )
                  throw new Error('Native guarded write refused');
                writes++;
                return result;
              },
            };
            await scope.runWithAdapter(
              scoped as never,
              (async () => {
                // Never call the native update unless the guard is installed.
                if (
                  (await scope.getCurrentAdapter(undefined as never)) !== scoped
                )
                  throw new Error('Native adapter scope is unavailable');
                return context.internalAdapter.updateUser(
                  selected.userId as never,
                  { email: selected.declared, emailVerified: false } as never,
                );
              }) as never,
            );
            if (writes !== 1)
              throw new Error('Native address change did not use the guard');
          }
          // A person may have signed in as this account under either address.
          await context.internalAdapter.deleteUserSessions(
            selected.userId as never,
          );
          const after = await current(context, selected);
          if ('refusal' in after || after.email !== selected.declared)
            throw new Error('Native address readback differs');
          if (
            z
              .array(z.unknown())
              .parse(
                await context.internalAdapter.listSessions(
                  selected.userId as never,
                ),
              ).length !== 0
          )
            throw new Error('Native operator sessions remain');
          renamed = writes === 1;
        });
      } catch {
        throw externalDepError('Native operator address migration failed.');
      }
      if (refusal) throw preconditionError(refusal);
      if (renamed === undefined)
        throw externalDepError('Native operator address migration failed.');
      return { renamed };
    },
  };
}
