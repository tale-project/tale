import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { passwordHashSchema } from '../crypto/password-hash';
import {
  identifier,
  nativeOriginSchema,
  withBackendAuth,
  type BackendAdapterOptions,
  type NativeClientContext,
} from './native-client';
import {
  provisionStatePath,
  readProvisionStateProof,
  writeProvisionState,
} from './provision-state';

export const BREAK_GLASS_STATE = 'break-glass.json';
const BREAK_GLASS_NAME = 'Break-glass administrator';

/** `pending` until the declared account first converges. `userId` is bound as
 * soon as the account exists, before its credential does. `credentialPending`
 * is journaled before a credential write — `linked` for an account that had
 * none, `replaced` for one that did — and cleared only once that account's
 * sessions are proven ended, so an interrupted write still ends them. */
export const breakGlassStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.enum(['pending', 'ready']),
  origin: nativeOriginSchema,
  email: z.email(),
  userId: identifier.optional(),
  credentialPending: z.enum(['linked', 'replaced']).optional(),
});
export type BreakGlassState = z.infer<typeof breakGlassStateSchema>;
export const breakGlassResultSchema = z.strictObject({
  userId: identifier,
  email: z.email(),
  created: z.boolean(),
  credentialUpdated: z.boolean(),
});
export type BreakGlassResult = z.infer<typeof breakGlassResultSchema>;
export interface BreakGlassInput {
  operatorUserId: string;
  email: string;
  passwordHash: string;
  headers: Headers;
  stateDirectory: string;
  migrateOriginFrom?: string;
}
export type BreakGlassAccount = (
  input: BreakGlassInput,
) => Promise<BreakGlassResult>;

/** A journal written at the current origin is admitted in either phase: only
 * a run at that origin can have written it, so an interrupted run resumes even
 * while a hostname migration is still declared. The previous origin's journal
 * is admitted once it is complete, as for every other migrated binding. */
export function admitsBreakGlassOrigin(
  state: Pick<BreakGlassState, 'origin' | 'phase'>,
  origin: string,
  migrateOriginFrom?: string,
): boolean {
  return (
    state.origin === origin ||
    (migrateOriginFrom !== undefined &&
      state.phase === 'ready' &&
      state.origin === migrateOriginFrom)
  );
}

type AsyncCall = (...args: never[]) => Promise<unknown>;
const callable = z.custom<AsyncCall>((value) => typeof value === 'function');
const contextSchema = z.object({
  options: z.object({ emailAndPassword: z.unknown().optional() }).passthrough(),
  internalAdapter: z.object({
    findUserByEmail: callable,
    findAccounts: callable,
    createUser: callable,
    linkAccount: callable,
    updatePassword: callable,
    deleteUserSessions: callable,
    listSessions: callable,
  }),
});
// A custom native hasher could not verify the declared hash at sign-in.
const passwordOptions = z
  .object({ enabled: z.literal(true), password: z.undefined() })
  .passthrough();
const sessionSchema = z.object({
  user: z.object({ id: identifier }),
  session: z.object({ userId: identifier }),
});
const userSchema = z.object({
  id: identifier,
  email: z.email(),
  emailVerified: z.boolean(),
});
const accountSchema = z.object({
  userId: identifier,
  providerId: z.string(),
  password: z.string().nullable().optional(),
});

/** Backend-local: the declared break-glass address holds one administrator
 * account whose credential is exactly the declared Better Auth hash. The
 * plaintext never reaches the deployment, and this account never signs in
 * here. A retained journal binds the address to one account ID. */
export function createBackendBreakGlassAccount(
  options: BackendAdapterOptions,
): BreakGlassAccount {
  return async (input) => {
    const selected = z
      .object({
        operatorUserId: identifier,
        email: z.email().max(254),
        passwordHash: passwordHashSchema,
        stateDirectory: z.string().min(1),
        migrateOriginFrom: nativeOriginSchema.optional(),
      })
      .safeParse(input);
    if (!selected.success || !(input.headers instanceof Headers))
      throw preconditionError('Invalid break-glass administrator input.');
    const { operatorUserId, passwordHash, stateDirectory, migrateOriginFrom } =
      selected.data;
    const email = selected.data.email.toLowerCase();
    let refusal: string | undefined;
    let result: BreakGlassResult | undefined;
    try {
      await withBackendAuth(options, async (auth) => {
        const native = z.object({ getSession: callable }).parse(auth.api);
        const context = contextSchema.parse(await auth.$context);
        if (
          !passwordOptions.safeParse(context.options.emailAndPassword).success
        )
          throw new Error('Unsupported native password policy');
        const session = sessionSchema.parse(
          await native.getSession({
            headers: input.headers,
            query: { disableCookieCache: true, disableRefresh: true },
          } as never),
        );
        if (
          session.user.id !== operatorUserId ||
          session.session.userId !== operatorUserId
        )
          throw new Error('Authenticated session differs');
        const file = provisionStatePath(stateDirectory, BREAK_GLASS_STATE);
        const retained = readProvisionStateProof(file, breakGlassStateSchema);
        if (
          retained &&
          (retained.value.email !== email ||
            !admitsBreakGlassOrigin(
              retained.value,
              options.origin,
              migrateOriginFrom,
            ))
        ) {
          refusal =
            'Retained break-glass administrator differs from the declared address.';
          return;
        }
        const lookup = async () => {
          const found = z
            .object({ user: userSchema })
            .nullable()
            .parse(
              await context.internalAdapter.findUserByEmail(email as never),
            );
          if (found && found.user.email.toLowerCase() !== email)
            throw new Error('Native address lookup differs');
          return found?.user;
        };
        const accountsOf = async (userId: string) => {
          const accounts = z
            .array(accountSchema)
            .max(64)
            .parse(await context.internalAdapter.findAccounts(userId as never));
          if (accounts.some((account) => account.userId !== userId))
            throw new Error('Native account lookup differs');
          return accounts;
        };
        const credentials = async (userId: string) =>
          (await accountsOf(userId)).filter(
            (account) => account.providerId === 'credential',
          );
        const existing = await lookup();
        const bound = retained?.value.userId;
        if (existing?.id === operatorUserId) {
          refusal = 'The break-glass address belongs to the deploy operator.';
          return;
        }
        if (bound && existing && existing.id !== bound) {
          refusal =
            'The break-glass address belongs to an account other than the retained administrator.';
          return;
        }
        if (bound && !existing) {
          refusal =
            'The retained break-glass administrator no longer holds its address; no replacement was created.';
          return;
        }
        // The only unbound account this may take over is the one its own
        // interrupted creation left behind: journaled as pending and holding
        // no way in yet. Any other account at the address belongs to whoever
        // created it, and making it an administrator would hand them the
        // organization.
        if (
          !bound &&
          existing &&
          (retained?.value.phase !== 'pending' ||
            (await accountsOf(existing.id)).length !== 0)
        ) {
          refusal =
            'The break-glass address belongs to an account this deployment did not create.';
          return;
        }
        let state: BreakGlassState;
        let digest: string;
        if (retained) {
          state = retained.value;
          digest = retained.sha256;
        } else {
          provisionStatePath(stateDirectory, BREAK_GLASS_STATE, true);
          state = breakGlassStateSchema.parse({
            schemaVersion: 1,
            phase: 'pending',
            origin: options.origin,
            email,
          });
          digest = writeProvisionState(file, state, true).sha256;
        }
        // Each later write replaces exactly the journal this run last wrote.
        const advance = (next: BreakGlassState) => {
          const current = readProvisionStateProof(file, breakGlassStateSchema);
          if (current?.sha256 !== digest)
            throw new Error('Break-glass intent changed');
          state = breakGlassStateSchema.parse(next);
          digest = writeProvisionState(file, state).sha256;
        };
        // Pending means the account's first convergence has not finished,
        // whichever run began it.
        const created = state.phase === 'pending';
        let userId: string;
        if (existing) {
          userId = existing.id;
          if (!bound) advance({ ...state, userId });
        } else {
          const user = userSchema.parse(
            await context.internalAdapter.createUser({
              email,
              name: BREAK_GLASS_NAME,
              emailVerified: true,
            } as never),
          );
          if (user.email.toLowerCase() !== email || !user.emailVerified)
            throw new Error('Native account creation differs');
          userId = user.id;
          // The platform's adapter commits each write on its own, so the
          // account is bound before its credential exists.
          advance({ ...state, userId });
        }
        const current = await credentials(userId);
        if (
          !current.length ||
          current.some((account) => account.password !== passwordHash)
        ) {
          advance({
            ...state,
            userId,
            credentialPending: current.length ? 'replaced' : 'linked',
          });
          if (current.length)
            await context.internalAdapter.updatePassword(
              userId as never,
              passwordHash as never,
            );
          else
            await context.internalAdapter.linkAccount({
              userId,
              providerId: 'credential',
              accountId: userId,
              password: passwordHash,
            } as never);
        }
        const written = state.credentialPending;
        if (written) {
          // A written credential ends every session the account held, also
          // when an interrupted run wrote it and this one completes it.
          await context.internalAdapter.deleteUserSessions(userId as never);
          if (
            z
              .array(z.unknown())
              .parse(
                await context.internalAdapter.listSessions(userId as never),
              ).length !== 0
          )
            throw new Error('Native break-glass sessions remain');
        }
        const after = await lookup();
        const stored = await credentials(userId);
        if (
          after?.id !== userId ||
          !stored.length ||
          stored.some((account) => account.password !== passwordHash)
        )
          throw new Error('Native break-glass readback differs');
        const ready = breakGlassStateSchema.parse({
          schemaVersion: 1,
          phase: 'ready',
          origin: options.origin,
          email,
          userId,
        });
        if (JSON.stringify(state) !== JSON.stringify(ready)) advance(ready);
        else if (
          readProvisionStateProof(file, breakGlassStateSchema)?.sha256 !==
          digest
        )
          throw new Error('Break-glass intent changed');
        result = {
          userId,
          email,
          created,
          credentialUpdated: written === 'replaced',
        };
      });
    } catch {
      throw externalDepError(
        'Native break-glass administrator provisioning failed.',
      );
    }
    if (refusal) throw preconditionError(refusal);
    if (!result)
      throw externalDepError(
        'Native break-glass administrator provisioning failed.',
      );
    return breakGlassResultSchema.parse(result);
  };
}

const memberSchema = z.object({
  id: identifier,
  organizationId: identifier,
  userId: identifier,
  role: z.string().min(1).max(64),
});
const administrative = new Set(['owner', 'admin']);

/** Membership converges through the operator session's own member doors, with
 * their audit trail: an absent account is added as `admin`, any other role
 * becomes `admin`, and an `owner` is never modified. */
export async function reconcileBreakGlassMembership(
  context: Pick<
    NativeClientContext,
    'organization' | 'request' | 'requireJson'
  >,
  userId: string,
): Promise<void> {
  const organizationId = context.organization.id;
  // Every member door sits behind the organization-scope check, the
  // by-member ones included, so each call names the organization.
  const scope = `orgId=${encodeURIComponent(organizationId)}`;
  const path = `/api/app/members?${scope}`;
  async function read() {
    const list = z
      .object({ members: z.array(memberSchema).max(10_000) })
      .safeParse(
        await context.requireJson(
          await context.request(path),
          'Organization member lookup',
        ),
      );
    if (
      !list.success ||
      list.data.members.some(
        (member) => member.organizationId !== organizationId,
      )
    )
      throw preconditionError('Unexpected organization member response.');
    const matches = list.data.members.filter(
      (member) => member.userId === userId,
    );
    if (matches.length > 1)
      throw preconditionError(
        'Ambiguous break-glass administrator membership.',
      );
    return matches[0];
  }
  const before = await read();
  if (before && administrative.has(before.role.toLowerCase())) return;
  if (!before)
    await context.requireJson(
      await context.request(path, 'POST', { userId, role: 'admin' }),
      'Break-glass administrator membership',
    );
  else
    await context.requireJson(
      await context.request(
        `/api/app/members/${encodeURIComponent(before.id)}/role?${scope}`,
        'POST',
        { role: 'admin' },
      ),
      'Break-glass administrator role',
    );
  const after = await read();
  if (after?.role.toLowerCase() !== 'admin')
    throw preconditionError(
      'Break-glass administrator membership did not converge.',
    );
}
