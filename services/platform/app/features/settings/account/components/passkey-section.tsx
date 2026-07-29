'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Table, TableBody, TableCell, TableRow } from '@tale/ui/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { PasskeyRegisterDialog } from './passkey-register-dialog';

// Minimal shape of a better-auth passkey row (the client returns more fields;
// we only render these). `name` is optional — older keys may lack it.
interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | number | Date | null;
}

const PASSKEYS_QUERY_KEY = ['passkeys', 'list'] as const;

/**
 * WebAuthn / passkey management (#1508). Lists the current user's registered
 * passkeys, lets them register a new one (the browser drives the ceremony via
 * `authClient.passkey.addPasskey` inside `PasskeyRegisterDialog`), and revoke
 * existing ones.
 *
 * Sits beside `TwoFactorSection`; a passkey counts as a phishing-resistant
 * second factor and satisfies an enforced org 2FA policy alongside TOTP.
 */
export function PasskeySection() {
  const { t } = useT('twoFactor');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // SSO-only users don't manage local credentials here (the IdP owns auth).
  const { data: status } = useConvexQuery(api.two_factor.queries.getStatus, {});

  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  // Revoking a passkey is destructive (it can drop the user's only
  // phishing-resistant second factor), so it confirms via `DeleteDialog`
  // rather than firing on the row's click. Track the row pending revocation.
  const [revokeTarget, setRevokeTarget] = useState<PasskeyRow | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const { data: passkeys, isLoading } = useQuery({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: async (): Promise<PasskeyRow[]> => {
      const res = await authClient.passkey.listUserPasskeys();
      if (res.error) {
        throw new Error(res.error.message ?? 'Failed to list passkeys');
      }
      return (res.data ?? []) as PasskeyRow[];
    },
    enabled: Boolean(status?.authenticated && status.hasCredential),
  });

  if (!status || !status.authenticated || !status.hasCredential) return null;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setIsRevoking(true);
    try {
      const result = await authClient.passkey.deletePasskey({
        id: revokeTarget.id,
      });
      if (result?.error) {
        toast({
          title: t('passkeys.errors.revokeFailed'),
          variant: 'destructive',
        });
        return;
      }
      toast({ title: t('passkeys.revoked'), variant: 'success' });
      invalidate();
      setRevokeTarget(null);
    } catch {
      toast({
        title: t('passkeys.errors.revokeFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <SettingsSection
      title={t('passkeys.title')}
      description={t('passkeys.description')}
      action={
        <Button variant="secondary" onClick={() => setRegisterDialogOpen(true)}>
          {t('passkeys.addButton')}
        </Button>
      }
    >
      {!isLoading && passkeys && passkeys.length > 0 && (
        <Table>
          <TableBody>
            {passkeys.map((pk) => (
              <TableRow key={pk.id} data-no-hover>
                <TableCell className="text-sm font-medium">
                  <span className="block truncate">
                    {pk.name?.trim() || t('passkeys.unnamed')}
                  </span>
                </TableCell>
                <TableCell className="w-0 text-right">
                  <IconButton
                    icon={Trash2}
                    variant="ghost"
                    aria-label={t('passkeys.revokeButton')}
                    onClick={() => setRevokeTarget(pk)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <PasskeyRegisterDialog
        open={registerDialogOpen}
        onOpenChange={setRegisterDialogOpen}
        onRegistered={() => {
          toast({ title: t('passkeys.registered'), variant: 'success' });
          invalidate();
        }}
      />

      <DeleteDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isRevoking) setRevokeTarget(null);
        }}
        title={t('passkeys.revokeConfirmTitle')}
        description={t('passkeys.revokeConfirmDescription', {
          name: revokeTarget?.name?.trim() || t('passkeys.unnamed'),
        })}
        deleteText={t('passkeys.revokeButton')}
        isDeleting={isRevoking}
        onDelete={() => void confirmRevoke()}
      />
    </SettingsSection>
  );
}
