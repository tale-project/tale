import { useQueryClient } from '@tanstack/react-query';

import { useBackendAction } from '@/app/hooks/use-backend-action';
import type { ArgsOf, ReturnsOf } from '@/app/lib/backend/contract';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { AppError } from '@/lib/shared/errors/app-error';
import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

import {
  buildCustomProviderDefinition,
  CUSTOM_VENDOR_KEY,
  uniqueProviderSlug,
  type CustomProviderFacts,
} from '../components/provider-definition-form';
import {
  useCreateCredential,
  useUpdateCredential,
  useUpdateCredentialWithDefinition,
} from './mutations';
import {
  providerCatalogsQueryKey,
  providerDefinitionsQueryPrefix,
  type ProviderCatalog,
} from './queries';

/**
 * The credential writes of the providers surface, as the shared credential
 * dialogs call them — with the organization's CUSTOM providers folded in.
 *
 * A custom provider is created from the credential dialog's pinned entry:
 * one form names the provider, its wire format, its base URL and the key.
 * That is two native writes — the provider definition file, then the
 * credential row — and this is where they become one mutation: the
 * definition first (the credential needs a slug to name), and, should the
 * credential then be refused, the definition taken back out so no provider
 * outlives the key it was created for. An edit of such a credential carries
 * the provider's facts beside the credential's own fields, and the server
 * takes both in one write or neither: each against the version the dialog
 * read, so a refused name never leaves the provider changed and a dialog
 * opened before someone else's save never writes over it.
 */

type CreateCredentialArgs =
  ArgsOf<'provider_credentials/actions:createCredential'>;
type UpdateCredentialArgs =
  ArgsOf<'provider_credentials/actions:updateCredential'>;

export type CreateProviderCredentialArgs = CreateCredentialArgs & {
  /** Present when the vendor is the custom entry: the provider to create. */
  customProvider?: CustomProviderFacts;
};

/** The native versions the edit dialog read a credential of an
 * organization-defined provider, and that provider, at. */
export interface ReviewedVersions {
  /** The credential's `hash` in the listing the dialog was seeded from. */
  credentialHash: string;
  /** The hash of the definition file the provider's facts were read from. */
  definitionHash: string;
}

export type UpdateProviderCredentialArgs = UpdateCredentialArgs & {
  /** Present for a credential of an organization-defined provider: the
   * provider's facts as the dialog now shows them. */
  customProvider?: CustomProviderFacts;
  /** What `customProvider` and the credential's fields were read at: the
   * edit saves against these, never against whatever is current at Save. */
  reviewed?: ReviewedVersions;
};

/** The refusal of an edit whose provider moved since the dialog read it —
 * the code the native compare-and-set answers the same case with. */
function versionConflict(): AppError {
  return new AppError({
    code: 'CONFIG_VERSION_CONFLICT',
    message: 'The provider changed since it was loaded.',
  });
}

function useDefinitionWrites() {
  const queryClient = useQueryClient();
  const read = useBackendAction(
    'lib/providers/definition_actions:getProviderDefinition',
    { errorToast: false },
  );
  const save = useBackendAction(
    'lib/providers/definition_actions:saveProviderDefinition',
    { errorToast: false },
  );
  const remove = useBackendAction(
    'lib/providers/definition_actions:deleteProviderDefinition',
    { errorToast: false },
  );
  // Every provider key the organization can already see, shipped or its
  // own, from the listing the page holds: a new slug must be free of both.
  const takenNames = (organizationId: string): ReadonlySet<string> =>
    new Set(
      (
        queryClient.getQueryData<ProviderCatalog[]>(
          providerCatalogsQueryKey(organizationId),
        ) ?? []
      ).map((catalog) => catalog.name),
    );
  // A definition is a catalog entry: the listing (and the cached
  // definition snapshots, whose hash the next save names) refetch, and so
  // do the credential reads, whose hashes an edit names too — after a
  // refusal as well, so a reopened dialog reads what refused it.
  const invalidate = (organizationId: string): void => {
    void queryClient.invalidateQueries({
      queryKey: providerCatalogsQueryKey(organizationId),
    });
    void queryClient.invalidateQueries({
      queryKey: providerDefinitionsQueryPrefix(organizationId),
    });
    void queryClient.invalidateQueries({
      queryKey: backendEntityPrefix(
        organizationId,
        PROVIDER_CREDENTIAL_HINT_ENTITY,
      ),
    });
  };
  return { read, save, remove, takenNames, invalidate };
}

/** Create one credential — and, for the custom entry, the provider it is for. */
export function useCreateProviderCredential() {
  const create = useCreateCredential();
  const { save, remove, takenNames, invalidate } = useDefinitionWrites();
  const isPending = create.isPending || save.isPending || remove.isPending;

  const mutateAsync = async (
    args: CreateProviderCredentialArgs,
  ): Promise<ReturnsOf<'provider_credentials/actions:createCredential'>> => {
    const { customProvider, ...credentialArgs } = args;
    if (credentialArgs.providerSlug !== CUSTOM_VENDOR_KEY) {
      return create.mutateAsync(credentialArgs);
    }
    if (customProvider === undefined) {
      throw new AppError({
        code: 'PROVIDER_DEFINITION_INVALID',
        message: 'The custom provider needs its base URL and API format.',
      });
    }
    const { organizationId } = credentialArgs;
    const name = uniqueProviderSlug(
      credentialArgs.name,
      takenNames(organizationId),
    );
    const built = buildCustomProviderDefinition({
      name,
      displayName: credentialArgs.name,
      apiFormat: customProvider.apiFormat,
      baseUrl: customProvider.baseUrl,
      catalogSource: customProvider.catalogSource,
    });
    if (!built.ok) {
      throw new AppError({
        code: 'PROVIDER_DEFINITION_INVALID',
        message: built.message,
      });
    }
    await save.mutateAsync({
      organizationId,
      name,
      config: built.config,
      expectedHash: null,
    });
    try {
      return await create.mutateAsync({
        ...credentialArgs,
        providerSlug: name,
      });
    } catch (error) {
      // A provider without its key is not what the reader asked for: take the
      // definition back out, then report the credential's refusal.
      try {
        await remove.mutateAsync({ organizationId, name });
      } catch (rollbackError) {
        console.error(
          'providers: could not roll back the custom provider definition',
          rollbackError,
        );
      }
      throw error;
    } finally {
      invalidate(organizationId);
    }
  };

  return { mutateAsync, isPending };
}

/** Update one credential — and, for an organization-defined provider, the
 * provider's facts the dialog edits beside it. */
export function useUpdateProviderCredential() {
  const update = useUpdateCredential();
  const updateWithDefinition = useUpdateCredentialWithDefinition();
  const { read, invalidate } = useDefinitionWrites();
  const isPending =
    update.isPending || read.isPending || updateWithDefinition.isPending;

  const mutateAsync = async (
    args: UpdateProviderCredentialArgs,
  ): Promise<ReturnsOf<'provider_credentials/actions:updateCredential'>> => {
    const { customProvider, reviewed, ...credentialArgs } = args;
    if (customProvider === undefined) {
      return update.mutateAsync(credentialArgs);
    }
    // Exactly the fields the edit dialog sends; the door takes nothing else.
    const { organizationId, credentialId, name, endpointUrl, modelAllowlist } =
      credentialArgs;
    const slug = customProvider.providerSlug;
    try {
      if (reviewed === undefined) throw versionConflict();
      // The definition is read for the fields the form has no input for
      // (they ride along unchanged), and only while it is still the version
      // the dialog showed: a newer one is someone else's save.
      const snapshot = await read.mutateAsync({ organizationId, name: slug });
      if (snapshot.config === null) {
        throw new AppError({
          code: 'PROVIDER_NOT_FOUND',
          message: 'This provider no longer exists.',
        });
      }
      if (snapshot.hash !== reviewed.definitionHash) throw versionConflict();
      const built = buildCustomProviderDefinition(
        {
          name: slug,
          // The name names the provider as well as the key.
          displayName:
            typeof name === 'string' && name.trim().length > 0
              ? name
              : snapshot.config.displayName,
          apiFormat: customProvider.apiFormat,
          baseUrl: customProvider.baseUrl,
          catalogSource: customProvider.catalogSource,
        },
        snapshot.config,
      );
      if (!built.ok) {
        throw new AppError({
          code: 'PROVIDER_DEFINITION_INVALID',
          message: built.message,
        });
      }
      // One write: the server takes the credential and the definition
      // together, each against its reviewed version, or neither.
      return await updateWithDefinition.mutateAsync({
        organizationId,
        credentialId,
        name,
        endpointUrl,
        modelAllowlist,
        expectedHash: reviewed.credentialHash,
        definition: {
          config: built.config,
          expectedHash: reviewed.definitionHash,
        },
      });
    } finally {
      // Saved or refused as stale, the listing (and the hash it carries)
      // is behind the definition either way.
      invalidate(organizationId);
    }
  };

  return { mutateAsync, isPending };
}
