'use client';

import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { EmptyState } from '@tale/ui/empty-state';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Plus, Server } from 'lucide-react';
import { useMemo, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';

import {
  providerCredentialAdapter,
  toProviderVendor,
} from '../credential-adapter';
import type { MaskedCredential, ProviderCatalog } from '../hooks/queries';
import { CustomProviderRowActions } from './custom-provider-row-actions';
import {
  ProviderDefinitionDialog,
  type ProviderDefinitionDialogMode,
} from './provider-definition-dialog';

/**
 * The organization's own provider definitions — the endpoints it runs or
 * subscribes to beyond the shipped vendors — as a list with add, edit,
 * check and delete.
 *
 * A section of its own rather than a footnote in the credential picker: the
 * picker is where an operator looked for their vLLM box and concluded the
 * platform could not reach it. The rows are the organization's entries of the
 * same catalog listing the credential table joins against, so a definition
 * saved here is a vendor the picker offers on its next open, and the row
 * carries the listing's catalog error exactly as a credential row does.
 */
export function CustomProvidersSection({
  organizationId,
  catalogs,
  credentials,
  isLoading,
  isError,
  onRetry,
}: {
  organizationId: string;
  /** The whole catalog listing; the section keeps the organization's own. */
  catalogs: readonly ProviderCatalog[];
  credentials: readonly MaskedCredential[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t } = useT('settings');
  const [dialog, setDialog] = useState<ProviderDefinitionDialogMode | null>(
    null,
  );

  const custom = useMemo(
    () =>
      catalogs
        .filter((catalog) => catalog.origin === 'organization')
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [catalogs],
  );
  // Every key the organization can see, shipped or its own: a new identifier
  // must be free of both, and the dialog refuses a taken one before asking.
  const takenNames = useMemo(
    () => new Set(catalogs.map((catalog) => catalog.name)),
    [catalogs],
  );
  const credentialCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const credential of credentials) {
      counts.set(
        credential.providerSlug,
        (counts.get(credential.providerSlug) ?? 0) + 1,
      );
    }
    return counts;
  }, [credentials]);

  const openCreate = () => setDialog({ kind: 'create' });
  const addButton = (
    <Button variant="secondary" onClick={openCreate} disabled={isLoading}>
      <Plus className="mr-1.5 size-4" />
      {t('providers.custom.add')}
    </Button>
  );
  const empty = !isLoading && !isError && custom.length === 0;

  return (
    <SettingsSection
      title={t('providers.custom.title')}
      description={t('providers.custom.description')}
      // The empty state carries the one create affordance, as a table's does.
      action={empty ? undefined : addButton}
    >
      {isError ? (
        <CatalogLoadError
          message={t('providers.custom.listFailed')}
          onRetry={onRetry}
        />
      ) : empty ? (
        <EmptyState
          icon={Server}
          title={t('providers.custom.empty.title')}
          description={t('providers.custom.empty.description')}
          action={addButton}
        />
      ) : (
        <Skeletonize loading={isLoading}>
          <ul className="border-border divide-border divide-y rounded-lg border">
            {(isLoading ? LOADING_ROWS : custom).map((provider) => (
              <CustomProviderRow
                key={provider.name}
                organizationId={organizationId}
                provider={provider}
                credentialCount={credentialCounts.get(provider.name) ?? 0}
                onEdit={() => setDialog({ kind: 'edit', name: provider.name })}
              />
            ))}
          </ul>
        </Skeletonize>
      )}

      {/* Mounted only while open, so every open starts from a clean form. */}
      {dialog !== null && (
        <ProviderDefinitionDialog
          organizationId={organizationId}
          mode={dialog}
          takenNames={takenNames}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
    </SettingsSection>
  );
}

const LOADING_ROWS: ProviderCatalog[] = Array.from({ length: 2 }, (_, i) => ({
  name: `loading-${i}`,
  displayName: 'Provider',
  origin: 'organization',
  apiFormat: 'openai',
  baseUrl: 'https://models.example.com/v1',
  catalogSource: 'models-endpoint',
  authMethods: ['api-key'],
  models: [],
}));

function CustomProviderRow({
  organizationId,
  provider,
  credentialCount,
  onEdit,
}: {
  organizationId: string;
  provider: ProviderCatalog;
  credentialCount: number;
  onEdit: () => void;
}) {
  const { t } = useT('settings');
  // The same wire-facts line the credential picker shows for the vendor.
  const facts = providerCredentialAdapter.vendorMeta(
    t,
    toProviderVendor(provider),
  );

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SkeletonBox asChild>
            <span className="text-foreground truncate text-sm font-medium">
              {provider.displayName}
            </span>
          </SkeletonBox>
          <SkeletonBox asChild>
            <code className="text-muted-foreground text-xs">
              {provider.name}
            </code>
          </SkeletonBox>
        </div>
        <SkeletonBox asChild>
          <span className="text-muted-foreground text-xs">{facts}</span>
        </SkeletonBox>
        {provider.catalogError !== undefined && (
          <p className="text-destructive text-xs">
            {t('providers.card.catalogUnavailable', {
              error: provider.catalogError,
            })}
          </p>
        )}
      </div>
      <CustomProviderRowActions
        organizationId={organizationId}
        provider={provider}
        credentialCount={credentialCount}
        onEdit={onEdit}
      />
    </li>
  );
}
