'use client';

import { Button } from '@tale/ui/button';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { type ReactNode, useState } from 'react';

import { useCurrentUser } from '@/app/hooks/use-current-user';
import { useT } from '@/lib/i18n/client';
import type { DocumentSyncHealth } from '@/types/documents';

import { GoogleReauthButton } from './google-reauth-button';
import { MicrosoftReauthButton } from './microsoft-reauth-button';

interface SyncHealthButtonProps {
  health: DocumentSyncHealth;
  /** The synced item's display name (the folder, or the picked file). */
  itemName: string;
  /** The Source cell's mark — the vendor logo plus the failure glyph. */
  children: ReactNode;
}

/** The vendor as the copy names it — the engines' `displayName`. */
const PROVIDER_LABEL: Record<DocumentSyncHealth['provider'], string> = {
  onedrive: 'OneDrive',
  google_drive: 'Google Drive',
};

/**
 * The Source cell of a synced row whose sync stopped working: the mark turns
 * into a button that opens the reason and the way back, named by what is
 * wrong and tipped with what to do. A dead grant names the member whose
 * account the sync runs under — the one person who can reconnect it — and
 * hands that member the reconnect button; everyone else learns whom to ask,
 * or that a fresh sync import takes the sync over. Renders nothing for a
 * healthy sync (the plain source mark stands).
 */
export function SyncHealthButton({
  health,
  itemName,
  children,
}: SyncHealthButtonProps) {
  const { t } = useT('documents');
  const { formatDate } = useFormatDate();
  const { data: currentUser } = useCurrentUser();
  const [open, setOpen] = useState(false);

  if (health.status !== 'failed') return null;

  const provider = PROVIDER_LABEL[health.provider];
  const isOwner = currentUser?.userId === health.ownerUserId;
  const label = health.needsReauth
    ? t('syncHealth.badge.needsReauth')
    : t('syncHealth.badge.failed');
  const title = health.needsReauth
    ? t('syncHealth.dialog.needsReauthTitle', { provider })
    : t('syncHealth.dialog.failedTitle');
  const description = health.needsReauth
    ? t('syncHealth.dialog.needsReauthDescription', {
        provider,
        name: itemName,
      })
    : t('syncHealth.dialog.failedDescription', { name: itemName });

  return (
    <>
      <Button
        variant="ghost"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={title}
        tooltip={label}
        // A row of marks, not a toolbar of buttons: the box hugs the mark and
        // the negative margin keeps it on the column's left edge, while `h-6`
        // holds the 24px target every pressable element owes a pointer.
        className="focus-visible:ring-border-strong -mx-1 h-6 gap-1 rounded-md px-1"
      >
        {children}
      </Button>
      <ViewDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
      >
        <Stack gap={3} className="mt-4">
          {health.errorSince !== undefined && (
            <Text>
              {t('syncHealth.dialog.failingSince', {
                time: formatDate(new Date(health.errorSince), 'long'),
              })}
            </Text>
          )}
          <Text variant="muted">
            {health.ownerName !== undefined
              ? t('syncHealth.dialog.syncedBy', { ownerName: health.ownerName })
              : t('syncHealth.dialog.syncedByUnknown')}
          </Text>
          {health.needsReauth ? (
            isOwner ? (
              <Stack gap={2}>
                <Text>{t('syncHealth.dialog.ownerNextStep')}</Text>
                <div>
                  {health.provider === 'onedrive' ? (
                    <MicrosoftReauthButton error="RefreshTokenError" />
                  ) : (
                    <GoogleReauthButton error="RefreshTokenError" />
                  )}
                </div>
              </Stack>
            ) : (
              <Text>
                {health.ownerName !== undefined
                  ? t('syncHealth.dialog.otherNextStep', {
                      ownerName: health.ownerName,
                    })
                  : t('syncHealth.dialog.otherNextStepUnknown')}
              </Text>
            )
          ) : (
            health.errorMessage !== undefined && (
              <div>
                <Text variant="label" className="mb-2">
                  {t('syncHealth.dialog.errorDetails')}
                </Text>
                <pre className="bg-muted max-h-[200px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                  {health.errorMessage}
                </pre>
              </div>
            )
          )}
        </Stack>
      </ViewDialog>
    </>
  );
}
