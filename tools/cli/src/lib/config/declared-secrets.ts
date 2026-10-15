import {
  agentSecretDigestScope,
  connectorCredentialDigestScope,
  managedSecretDigest,
} from '@tale/shared/config/managed-secret';
import type { PlatformResource } from '@tale/shared/config/platform-resources';

import { preconditionError } from '../../utils/fail';

/** The kinds whose secret values a declaration takes from the environment
 * of the CLI that applies it. */
export type SecretResource = Extract<
  PlatformResource,
  { kind: 'agent-secret' | 'connector-credential' }
>;

export function isSecretResource(
  resource: PlatformResource,
): resource is SecretResource {
  return (
    resource.kind === 'agent-secret' || resource.kind === 'connector-credential'
  );
}

/** The longest value a secret field holds, as the platform's writers cap it. */
const SECRET_VALUE_MAX = 8192;

/**
 * The values a declaration's secrets take from the environment, read when a
 * plan or an apply needs them and never anywhere else: the declaration, its
 * plan and its journal carry the variables' names and hashes, and a
 * refusal names a variable, never what it holds. A value is trimmed as the
 * platform trims it before storing, so its digest is the stored value's.
 *
 * What the platform reads back for a secret as declared is computed here
 * ({@link desired}): the secret's identity and the digest of the value the
 * environment holds now. A different digest means the value changed — in
 * the environment, or by a person in Tale — and applying writes it.
 */
export class DeclaredSecrets {
  private readonly digests = new Map<string, string>();

  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly organizationId: string,
  ) {}

  private read(envName: string): string {
    const value = this.environment[envName]?.trim() ?? '';
    if (value.length === 0)
      throw preconditionError(
        `The environment variable ${envName}, which a declared secret reads its value from, is not set.`,
        'Set it in the environment of the command that plans and applies the declaration — inside a deployment, the platform’s own environment — then plan again.',
      );
    if (value.length > SECRET_VALUE_MAX)
      throw preconditionError(
        `The value of ${envName} is longer than ${SECRET_VALUE_MAX} characters.`,
      );
    return value;
  }

  /** The value an agent secret is written with. */
  agentSecretValue(
    resource: Extract<SecretResource, { kind: 'agent-secret' }>,
  ): string {
    return this.read(resource.config.envName);
  }

  /** The secret fields a connector credential is written with, by name. */
  connectorCredentialValues(
    resource: Extract<SecretResource, { kind: 'connector-credential' }>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(resource.config.fields).flatMap(([field, source]) =>
        source === undefined ? [] : [[field, this.read(source.env)] as const],
      ),
    );
  }

  /** A digest is slow on purpose; one run computes each secret's once (a
   * declaration names each secret once, and the environment does not
   * change while it runs). */
  private digest(scope: string, value: () => string | Record<string, string>) {
    let digest = this.digests.get(scope);
    if (digest === undefined) {
      digest = managedSecretDigest({
        organizationId: this.organizationId,
        scope,
        value: value(),
      });
      this.digests.set(scope, digest);
    }
    return digest;
  }

  /** What the platform reads back once the secret is as declared, with the
   * fields a declaration may leave out left out where it does. */
  desired(resource: SecretResource): Record<string, unknown> {
    if (resource.kind === 'agent-secret')
      return {
        name: resource.config.name,
        valueDigest: this.digest(
          agentSecretDigestScope(resource.config.name),
          () => this.agentSecretValue(resource),
        ),
      };
    const { connector, name, authMethod, endpoint, isDefault } =
      resource.config;
    return {
      connector,
      name,
      authMethod,
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(isDefault !== undefined ? { isDefault } : {}),
      fields: Object.keys(resource.config.fields).sort(),
      valueDigest: this.digest(
        connectorCredentialDigestScope(connector, name),
        () => this.connectorCredentialValues(resource),
      ),
    };
  }
}
