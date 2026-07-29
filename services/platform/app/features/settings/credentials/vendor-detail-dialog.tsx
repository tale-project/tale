'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';
import { CredentialCreateDialog } from './credential-create-dialog';
import { CredentialList } from './credential-list';

/**
 * What one card opens: the vendor's facts, its health, and the credentials the
 * organization holds for it.
 *
 * The grid stays a grid because of this. A card carries only what a reader
 * scans across twelve of them — name, one-line summary, a status badge — while
 * everything they act on lives here, one click deep, at full width. Expanding a
 * card in place would have destroyed the equal-height row the grid depends on.
 */
export function VendorDetailDialog<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  vendor,
  credentials,
  adapter,
  open,
  onOpenChange,
  description,
  facts,
  alerts,
  emptyBody,
  extraActions,
  children,
}: {
  organizationId: string;
  vendor: V;
  credentials: readonly Cred[];
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The vendor's own summary line. */
  description?: ReactNode;
  /** Catalog facts (tags, wire format, counts) shown above the credentials. */
  facts?: ReactNode;
  /** Surface-specific health alerts. */
  alerts?: ReactNode;
  emptyBody: ReactNode;
  /** Affordances beside "Add credential" (e.g. OAuth consent). */
  extraActions?: ReactNode;
  /** Anything else this surface shows for the vendor. */
  children?: ReactNode;
}) {
  const { t } = useT('settings');
  const [createOpen, setCreateOpen] = useState(false);

  const canAddByHand = adapter.formMethods(vendor).length > 0;

  return (
    <ViewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={vendor.displayName}
      description={description}
      size="wide"
      headerActions={
        <div className="flex flex-wrap items-center gap-2">
          {extraActions}
          {canAddByHand && (
            <Button icon={Plus} size="sm" onClick={() => setCreateOpen(true)}>
              {t('credentials.addCredential')}
            </Button>
          )}
        </div>
      }
    >
      <Stack gap={4}>
        {facts}
        <CredentialList
          organizationId={organizationId}
          vendor={vendor}
          credentials={credentials}
          adapter={adapter}
          alerts={alerts}
          emptyBody={emptyBody}
        />
        {children}
      </Stack>

      <CredentialCreateDialog
        organizationId={organizationId}
        vendor={vendor}
        adapter={adapter}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </ViewDialog>
  );
}
