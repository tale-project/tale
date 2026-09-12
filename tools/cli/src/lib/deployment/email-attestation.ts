import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { sha } from '../config/releases/model';
import {
  nativeOriginSchema,
  withBackendAuth,
  type BackendAdapterOptions,
} from './native-client';
import {
  provisionStatePath,
  readProvisionStateProof,
  writeProvisionState,
} from './provision-state';

const identifier = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const accountSchema = z.object({
  id: identifier,
  email: z.email(),
  emailVerified: z.boolean(),
});
export const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.enum(['pending', 'ready']),
  method: z.literal('operator-attested'),
  origin: nativeOriginSchema,
  userId: identifier,
  email: z.email(),
});
export const emailAttestationProofSchema = z.strictObject({
  method: z.literal('operator-attested'),
  userId: identifier,
  email: z.email(),
  emailVerified: z.literal(true),
  receipt: z.strictObject({ path: z.string().min(1), sha256: sha }),
});
export type EmailAttestationProof = z.infer<typeof emailAttestationProofSchema>;
export interface EmailAttestationInput {
  userId: string;
  email: string;
  headers: Headers;
  stateDirectory: string;
}
export type EmailAttestation = (
  input: EmailAttestationInput,
) => Promise<EmailAttestationProof>;

type AsyncCall = (...args: never[]) => Promise<unknown>;
const callable = z.custom<AsyncCall>((value) => typeof value === 'function');
const apiSchema = z.object({ getSession: callable, verifyEmail: callable });
const contextSchema = z.object({
  secret: z.string(),
  options: z
    .object({ emailVerification: z.unknown().optional() })
    .passthrough(),
  internalAdapter: z.object({
    findUserById: callable,
    findUserByEmail: callable,
  }),
  adapter: z.object({ update: callable }).passthrough(),
});
const safeOptions = z.strictObject({
  autoSignInAfterVerification: z.literal(false).optional(),
});

/** Administrative attestation is explicit in the verified fresh declaration.
 * The token stays in this isolated auth instance: no delivery, public route,
 * email change, callback URL or additional session is involved. */
export function createBackendEmailAttestation(
  options: BackendAdapterOptions,
): EmailAttestation {
  return async (input) => {
    const selected = z
      .object({
        userId: identifier,
        email: z.email(),
        stateDirectory: z.string().min(1),
      })
      .safeParse(input);
    if (!selected.success || !(input.headers instanceof Headers))
      throw preconditionError('Invalid operator email attestation input.');
    const email = selected.data.email.toLowerCase();
    let proof: EmailAttestationProof | undefined;
    try {
      await withBackendAuth(options, async (auth) => {
        const native = apiSchema.parse(auth.api);
        const rawContext = await auth.$context;
        const context = contextSchema.parse(rawContext);
        if (
          !safeOptions.safeParse(context.options.emailVerification ?? {})
            .success
        )
          throw new Error('Unsupported native verification policy');
        const session = z
          .object({
            user: accountSchema,
            session: z.object({ userId: identifier }),
          })
          .parse(
            await native.getSession({
              headers: input.headers,
              query: { disableCookieCache: true, disableRefresh: true },
            } as never),
          );
        const matches = (value: unknown) => {
          const user = accountSchema.parse(value);
          if (user.id !== input.userId || user.email.toLowerCase() !== email)
            throw new Error('Declared operator differs');
          return user;
        };
        matches(session.user);
        if (session.session.userId !== input.userId)
          throw new Error('Authenticated session differs');
        async function readAccount() {
          const byId = matches(
            await context.internalAdapter.findUserById(input.userId as never),
          );
          const byEmail = z
            .object({ user: accountSchema })
            .parse(
              await context.internalAdapter.findUserByEmail(email as never),
            );
          const account = matches(byEmail.user);
          if (account.emailVerified !== byId.emailVerified)
            throw new Error('Native identity changed while reading');
          return account;
        }
        const before = await readAccount();
        if (before.emailVerified !== session.user.emailVerified)
          throw new Error('Authenticated account verification differs');
        const file = provisionStatePath(
          input.stateDirectory,
          'email-attestation.json',
        );
        const retained = readProvisionStateProof(file, stateSchema);
        let pendingDigest = retained?.sha256;
        const target = {
          method: 'operator-attested' as const,
          origin: options.origin,
          userId: input.userId,
          email,
        };
        if (
          retained &&
          (retained.value.origin !== target.origin ||
            retained.value.userId !== target.userId ||
            retained.value.email !== email)
        )
          throw new Error('Retained attestation identity differs');
        if (retained?.value.phase === 'ready' && !before.emailVerified)
          throw new Error('Retained verification drifted');
        if (!retained) {
          provisionStatePath(
            input.stateDirectory,
            'email-attestation.json',
            true,
          );
          pendingDigest = writeProvisionState(
            file,
            { schemaVersion: 1, phase: 'pending', ...target },
            true,
          ).sha256;
        }
        if (!before.emailVerified) {
          const load =
            options.loadModule ??
            (async (id) => import(id) as Promise<unknown>);
          const tokenApi = z
            .object({ createEmailVerificationToken: callable })
            .parse(
              await load('/app/node_modules/better-auth/dist/api/index.mjs'),
            );
          const scopeApi = z
            .object({ runWithAdapter: callable, getCurrentAdapter: callable })
            .parse(
              await load(
                '/app/node_modules/@better-auth/core/dist/context/index.mjs',
              ),
            );
          // Use the actual native adapter object. Internal user-update hooks,
          // updatedAt mapping and session-cache refresh remain native-owned.
          const adapter = (
            rawContext as {
              adapter: Record<string, unknown> & { update: AsyncCall };
            }
          ).adapter;
          let writes = 0;
          const scoped = {
            ...adapter,
            update: async (value: unknown) => {
              const request = z
                .strictObject({
                  model: z.literal('user'),
                  update: z.strictObject({ emailVerified: z.literal(true) }),
                  where: z.tuple([
                    z.strictObject({
                      field: z.literal('email'),
                      value: z.literal(email),
                    }),
                  ]),
                })
                .parse(value);
              if (writes !== 0)
                throw new Error('Duplicate native verification write');
              const result = await adapter.update({
                ...request,
                where: [
                  ...request.where,
                  { field: 'id', value: input.userId, connector: 'AND' },
                  { field: 'emailVerified', value: false, connector: 'AND' },
                ],
              } as never);
              if (!matches(result).emailVerified)
                throw new Error('Native guarded write refused');
              writes++;
              return result;
            },
          };
          const token = z
            .string()
            .min(1)
            .max(4096)
            .parse(
              await tokenApi.createEmailVerificationToken(
                context.secret as never,
                email as never,
                undefined as never,
                60 as never,
              ),
            );
          const result = await scopeApi.runWithAdapter(
            scoped as never,
            (async () => {
              // Native runWithAdapter can fall back when ALS initialization fails.
              // Never call the write endpoint unless our guard is installed.
              if (
                (await scopeApi.getCurrentAdapter(undefined as never)) !==
                scoped
              )
                throw new Error('Native adapter scope is unavailable');
              return native.verifyEmail({ query: { token } } as never);
            }) as never,
          );
          z.strictObject({ status: z.literal(true), user: z.null() }).parse(
            result,
          );
          if (writes !== 1)
            throw new Error('Native verification did not use the guard');
        }
        if (!(await readAccount()).emailVerified)
          throw new Error('Native verification readback failed');
        const current = readProvisionStateProof(file, stateSchema);
        if (
          !current ||
          current.sha256 !== pendingDigest ||
          current.value.origin !== target.origin ||
          current.value.userId !== target.userId ||
          current.value.email !== email
        )
          throw new Error('Attestation intent changed');
        const receipt =
          current.value.phase === 'ready'
            ? { path: file, sha256: current.sha256 }
            : writeProvisionState(file, { ...current.value, phase: 'ready' });
        proof = emailAttestationProofSchema.parse({
          method: target.method,
          userId: input.userId,
          email,
          emailVerified: true,
          receipt,
        });
      });
    } catch {
      throw externalDepError('Native operator email attestation failed.');
    }
    if (!proof)
      throw externalDepError('Native operator email attestation failed.');
    return proof;
  };
}
