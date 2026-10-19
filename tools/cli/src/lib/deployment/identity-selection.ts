import { preconditionError } from '../../utils/fail';
import { oidcIssuer } from './identity-oidc';
import {
  resolveValue,
  type DeploymentSpec,
  type EnvironmentReference,
} from './model';

type Identity = NonNullable<DeploymentSpec['identity']>;
type Reference = string | EnvironmentReference;

/** The sign-in fields of the private provisioning input that the declared
 * identity resolves to in this destination's environment. */
export interface SignInFields {
  tenantId?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  oidc?: Record<string, unknown>;
}

interface Resolved {
  values: Record<string, string>;
  /** How many of the block's fields are references, not literals. */
  references: number;
  /** The environment variables that resolved to nothing. */
  missing: string[];
}

function resolveBlock(references: Record<string, Reference>): Resolved {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  let count = 0;
  for (const [field, reference] of Object.entries(references)) {
    values[field] = resolveValue(reference);
    if (typeof reference !== 'object') continue;
    count += 1;
    if (values[field] === '') missing.push(reference.env);
  }
  return { values, references: count, missing };
}

/** A block is usable when all of its references resolve; a block that resolves
 * only in part is a misconfigured destination, never a quiet fallback. */
function usable(label: string, block: Resolved): boolean {
  if (block.missing.length === 0) return true;
  if (block.missing.length === block.references) return false;
  throw preconditionError(
    `The ${label} environment references resolve only in part; set or unset ${block.missing.join(', ')} together with the rest of the block.`,
  );
}

/** Resolve the declared sign-in credentials for a destination that signs
 * people in (`ssoEnabled`). An identity that declares no OpenID Connect block
 * resolves exactly as it always did: Entra, every reference required. With
 * one, the block whose references resolve here is used; both resolving, or
 * neither, refuses the deployment before anything changes. */
export function resolveSignIn(identity: Identity): SignInFields {
  const { oidc } = identity;
  if (!oidc)
    return {
      tenantId: identity.tenantId && resolveValue(identity.tenantId),
      clientId: identity.clientId && resolveValue(identity.clientId),
      clientSecret:
        identity.clientSecret && resolveValue(identity.clientSecret),
    };
  const entraBlock =
    identity.tenantId && identity.clientId && identity.clientSecret
      ? resolveBlock({
          tenantId: identity.tenantId,
          clientId: identity.clientId,
          clientSecret: identity.clientSecret,
        })
      : undefined;
  const connectBlock = resolveBlock({
    issuer: oidc.issuer,
    clientId: oidc.clientId,
    clientSecret: oidc.clientSecret,
  });
  const entra = entraBlock && usable('Entra', entraBlock);
  const connect = usable('OpenID Connect', connectBlock);
  if (entra && connect)
    throw preconditionError(
      'Both the Entra and the OpenID Connect environment references resolve in this destination; give it one provider’s credentials.',
    );
  if (entraBlock && entra)
    return {
      tenantId: entraBlock.values.tenantId,
      clientId: entraBlock.values.clientId,
      clientSecret: entraBlock.values.clientSecret,
    };
  if (!connect)
    throw preconditionError(
      `Sign-in is enabled but the ${entraBlock ? 'Entra or OpenID Connect' : 'OpenID Connect'} environment references do not resolve in this destination.`,
    );
  // A literal issuer was judged with the declaration; one the environment
  // supplies is judged here, before anything is changed.
  if (
    typeof oidc.issuer === 'object' &&
    !oidcIssuer.safeParse(connectBlock.values.issuer).success
  )
    throw preconditionError(
      `${oidc.issuer.env} is not a canonical HTTPS issuer URL: no trailing slash, query or fragment.`,
    );
  return {
    oidc: {
      ...(oidc.displayName ? { displayName: oidc.displayName } : {}),
      ...(oidc.scopes ? { scopes: oidc.scopes } : {}),
      ...(oidc.pkce === undefined ? {} : { pkce: oidc.pkce }),
      ...(oidc.claimMappings ? { claimMappings: oidc.claimMappings } : {}),
      ...(oidc.trustEmail === undefined ? {} : { trustEmail: oidc.trustEmail }),
      ...connectBlock.values,
    },
  };
}
