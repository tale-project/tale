'use client';

import { Button } from '@tale/ui/button';
import { HStack, Stack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
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
  // Passkey pending destructive confirmation; `null` keeps the dialog closed.
  const [confirmTarget, setConfirmTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [revoking, setRevoking] = useState(false);

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

  async function handleRevoke() {
    if (!confirmTarget) return;
    setRevoking(true);
    try {
      const result = await authClient.passkey.deletePasskey({
        id: confirmTarget.id,
      });
      if (result?.error) {
        toast({
          title: t('passkeys.errors.revokeFailed'),
          variant: 'destructive',
        });
        return;
      }
      toast({ title: t('passkeys.revoked'), variant: 'success' });
      setConfirmTarget(null);
      invalidate();
    } catch {
      toast({
        title: t('passkeys.errors.revokeFailed'),
        variant: 'destructive',
      });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <SettingsSection
      className="border-border border-t pt-8"
      title={t('passkeys.title')}
      description={t('passkeys.description')}
      action={
        <Button variant="secondary" onClick={() => setRegisterDialogOpen(true)}>
          {t('passkeys.addButton')}
        </Button>
      }
    >
      {!isLoading && passkeys && passkeys.length > 0 && (
        <Stack gap={2}>
          {passkeys.map((pk) => {
            const name = pk.name?.trim() || t('passkeys.unnamed');
            return (
              <HStack
                key={pk.id}
                justify="between"
                align="center"
                className="rounded-md border px-3 py-2"
              >
                <VStack gap={0} className="min-w-0">
                  <Text className="truncate text-sm font-medium">{name}</Text>
                </VStack>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmTarget({ id: pk.id, name })}
                >
                  {t('passkeys.revokeButton')}
                </Button>
              </HStack>
            );
          })}
        </Stack>
      )}

      {!isLoading && (!passkeys || passkeys.length === 0) && (
        <Text variant="muted" className="text-sm">
          {t('passkeys.empty')}
        </Text>
      )}

      <PasskeyRegisterDialog
        open={registerDialogOpen}
        onOpenChange={setRegisterDialogOpen}
        onRegistered={() => {
          toast({ title: t('passkeys.registered'), variant: 'success' });
          invalidate();
        }}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmTarget(null);
        }}
        title={t('passkeys.confirmTitle')}
        description={t('passkeys.confirmDescription', {
          name: confirmTarget?.name ?? '',
        })}
        confirmText={t('passkeys.revokeButton')}
        variant="destructive"
        isLoading={revoking}
        onConfirm={handleRevoke}
      />
    </SettingsSection>
  );
}
