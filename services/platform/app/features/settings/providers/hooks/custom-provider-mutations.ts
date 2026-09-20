import { useQueryClient } from '@tanstack/react-query';

import { useBackendAction } from '@/app/hooks/use-backend-action';
import type { ArgsOf, ReturnsOf } from '@/app/lib/backend/contract';
import { AppError } from '@/lib/shared/errors/app-error';

import {
  buildCustomProviderDefinition,
  CUSTOM_VENDOR_KEY,
  uniqueProviderSlug,
  type CustomProviderFacts,
} from '../components/provider-definition-form';
import { useCreateCredential, useUpdateCredential } from './mutations';
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
 * the provider's facts the same way, saved against the definition's current
 * hash before the credential itself.
 */

type CreateCredentialArgs =
  ArgsOf<'provider_credentials/actions:createCredential'>;
type UpdateCredentialArgs =
  ArgsOf<'provider_credentials/actions:updateCredential'>;

export type CreateProviderCredentialArgs = CreateCredentialArgs & {
  /** Present when the vendor is the custom entry: the provider to create. */
  customProvider?: CustomProviderFacts;
};

export type UpdateProviderCredentialArgs = UpdateCredentialArgs & {
  /** Present for a credential of an organization-defined provider: the
   * provider's facts as the dialog now shows them. */
  customProvider?: CustomProviderFacts;
};

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
  // definition snapshots, whose hash the next save names) refetch.
  const invalidate = (organizationId: string): void => {
    void queryClient.invalidateQueries({
      queryKey: providerCatalogsQueryKey(organizationId),
    });
    void queryClient.invalidateQueries({
      queryKey: providerDefinitionsQueryPrefix(organizationId),
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
  const { read, save, invalidate } = useDefinitionWrites();
  const isPending = update.isPending || read.isPending || save.isPending;

  const mutateAsync = async (
    args: UpdateProviderCredentialArgs,
  ): Promise<ReturnsOf<'provider_credentials/actions:updateCredential'>> => {
    const { customProvider, ...credentialArgs } = args;
    if (customProvider !== undefined) {
      const { organizationId } = credentialArgs;
      const name = customProvider.providerSlug;
      const snapshot = await read.mutateAsync({ organizationId, name });
      if (snapshot.config === null) {
        throw new AppError({
          code: 'PROVIDER_NOT_FOUND',
          message: 'This provider no longer exists.',
        });
      }
      const built = buildCustomProviderDefinition(
        {
          name,
          // The name names the provider as well as the key.
          displayName:
            typeof credentialArgs.name === 'string' &&
            credentialArgs.name.trim().length > 0
              ? credentialArgs.name
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
      await save.mutateAsync({
        organizationId,
        name,
        config: built.config,
        expectedHash: snapshot.hash,
      });
      invalidate(organizationId);
    }
    return update.mutateAsync(credentialArgs);
  };

  return { mutateAsync, isPending };
}
