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
  /** The declaration manages an OpenID Connect connection, with this issuer
   * when the destination provides one. It is what lets a connection be
   * recognised as the managed one, whichever provider is enabled. */
  managedOidc?: { issuer?: string };
}

interface Resolved {
  values: Record<string, string>;
  /** The credential variables that resolved to nothing. */
  missing: string[];
  /** How many credentials the block names. */
  credentials: number;
  /** The public variables (an issuer) that resolved to nothing. */
  lacking: string[];
}

/** A block's credentials decide whether it is the destination's: its public
 * fields (an issuer) are only read, and may be present on a destination that
 * holds the other provider's credentials. */
function resolveBlock(
  credentials: Record<string, EnvironmentReference>,
  publicFields: Record<string, Reference> = {},
): Resolved {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const lacking: string[] = [];
  for (const [field, reference] of Object.entries(credentials)) {
    values[field] = resolveValue(reference);
    if (values[field] === '') missing.push(reference.env);
  }
  for (const [field, reference] of Object.entries(publicFields)) {
    values[field] = resolveValue(reference);
    if (values[field] === '' && typeof reference === 'object')
      lacking.push(reference.env);
  }
  return {
    values,
    missing,
    credentials: Object.keys(credentials).length,
    lacking,
  };
}

/** A block is usable when all of its references resolve and unusable when its
 * credentials all resolve to nothing; anything in between is a misconfigured
 * destination, never a quiet fallback. */
function usable(label: string, block: Resolved): boolean {
  if (block.missing.length === block.credentials) return false;
  const unset = [...block.missing, ...block.lacking];
  if (unset.length === 0) return true;
  throw preconditionError(
    `The ${label} environment references resolve only in part; set or unset ${unset.join(', ')} together with the rest of the block.`,
  );
}

function managedOidc(issuer: string): { issuer?: string } {
  return oidcIssuer.safeParse(issuer).success ? { issuer } : {};
}

/** What a destination that signs nobody in still needs of the declaration:
 * the issuer, with nothing required, so a managed connection can be removed. */
export function resolveManagedOidc(identity: Identity): SignInFields {
  const { oidc } = identity;
  if (!oidc) return {};
  return {
    managedOidc: managedOidc(
      typeof oidc.issuer === 'string'
        ? oidc.issuer
        : resolveValue({ ...oidc.issuer, optional: true }),
    ),
  };
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
  const connectBlock = resolveBlock(
    { clientId: oidc.clientId, clientSecret: oidc.clientSecret },
    { issuer: oidc.issuer },
  );
  const entra = entraBlock && usable('Entra', entraBlock);
  const connect = usable('OpenID Connect', connectBlock);
  if (entra && connect)
    throw preconditionError(
      'Both the Entra and the OpenID Connect environment references resolve in this destination; give it one provider’s credentials.',
    );
  const managed = {
    managedOidc: managedOidc(connectBlock.values.issuer ?? ''),
  };
  if (entraBlock && entra)
    return {
      tenantId: entraBlock.values.tenantId,
      clientId: entraBlock.values.clientId,
      clientSecret: entraBlock.values.clientSecret,
      ...managed,
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
    ...managed,
  };
}
