'use client';

import { useState, useEffect } from 'react';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { StatusIndicator } from '@/app/components/ui/feedback/status-indicator';
import { Description } from '@/app/components/ui/forms/description';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { toast } from '@/app/hooks/use-toast';
import { Input } from '@/app/components/ui/forms/input';
import { Button } from '@/app/components/ui/primitives/button';
import { Switch } from '@/app/components/ui/forms/switch';
import { Label } from '@/app/components/ui/forms/label';
import { useT } from '@/lib/i18n/client';
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

interface SSOProvider {
  _id: string;
  providerId: string;
  domain: string;
  autoProvisionEnabled: boolean;
}

interface SSOConfigDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  existingProvider?: SSOProvider | null;
}

const DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'https://graph.microsoft.com/GroupMember.Read.All',
  'https://graph.microsoft.com/Files.Read',
];

export function SSOConfigDialog({
  open,
  onOpenChange,
  organizationId,
  existingProvider,
}: SSOConfigDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const [domain, setDomain] = useState('');
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [autoProvisionEnabled, setAutoProvisionEnabled] = useState(true);
  const [excludeGroups, setExcludeGroups] = useState('');
  const [teamMembershipMode, setTeamMembershipMode] = useState<'sync' | 'additive'>('sync');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const upsertSSOProvider = useAction(api.sso_providers.mutations.upsert);
  const removeSSOProvider = useAction(api.sso_providers.mutations.remove);

  const isConnected = !!existingProvider;

  useEffect(() => {
    if (existingProvider) {
      setDomain(existingProvider.domain);
      setAutoProvisionEnabled(existingProvider.autoProvisionEnabled);
    } else {
      setDomain('');
      setIssuer('');
      setClientId('');
      setClientSecret('');
      setAutoProvisionEnabled(true);
      setExcludeGroups('');
      setTeamMembershipMode('sync');
    }
  }, [existingProvider, open]);

  const handleSave = async () => {
    if (!domain || !issuer || !clientId || !clientSecret) {
      toast({
        title: t('integrations.sso.validationError'),
        description: t('integrations.sso.allFieldsRequired'),
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await upsertSSOProvider({
        organizationId,
        providerId: 'entra-id',
        issuer,
        domain,
        clientId,
        clientSecret,
        scopes: DEFAULT_SCOPES,
        autoProvisionEnabled,
        excludeGroups: excludeGroups
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
        teamMembershipMode,
      });

      toast({
        title: isConnected
          ? t('integrations.sso.updateSuccessful')
          : t('integrations.sso.configureSuccessful'),
        description: t('integrations.sso.ssoConfigured'),
        variant: 'success',
      });

      onOpenChange?.(false);
    } catch (error) {
      toast({
        title: t('integrations.sso.configureFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.sso.configureError'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsSubmitting(true);
    try {
      await removeSSOProvider({ organizationId });

      toast({
        title: t('integrations.sso.disconnected'),
        description: t('integrations.sso.ssoDisconnected'),
      });

      onOpenChange?.(false);
    } catch (error) {
      toast({
        title: t('integrations.sso.disconnectFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.sso.disconnectError'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = isConnected ? (
    <>
      <Button
        variant="destructive"
        onClick={handleDisconnect}
        disabled={isSubmitting}
        className="flex-1"
      >
        {isSubmitting
          ? t('integrations.disconnecting')
          : t('integrations.disconnect')}
      </Button>
      <Button
        onClick={handleSave}
        disabled={isSubmitting || !domain || !clientId || !clientSecret}
        className="flex-1"
      >
        {isSubmitting ? t('integrations.sso.updating') : t('integrations.sso.update')}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="outline"
        className="flex-1"
        onClick={() => onOpenChange?.(false)}
      >
        {tCommon('actions.cancel')}
      </Button>
      <Button
        onClick={handleSave}
        className="flex-1"
        disabled={isSubmitting || !domain || !issuer || !clientId || !clientSecret}
      >
        {isSubmitting
          ? t('integrations.sso.configuring')
          : t('integrations.sso.configure')}
      </Button>
    </>
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.sso.title')}
      customFooter={footer}
      isSubmitting={isSubmitting}
      large
    >
      {isConnected && (
        <StatusIndicator variant="success">
          {t('integrations.sso.connectedToEntra')}
        </StatusIndicator>
      )}

      <Stack gap={4}>
        <Stack gap={3}>
          <Input
            id="sso-domain"
            label={t('integrations.sso.domainLabel')}
            placeholder="yourcompany.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={isSubmitting}
          />
          <Description className="text-xs">
            {t('integrations.sso.domainHelp')}
          </Description>
        </Stack>

        <Stack gap={3}>
          <Input
            id="sso-issuer"
            label={t('integrations.sso.issuerLabel')}
            placeholder="https://login.microsoftonline.com/{tenant-id}/v2.0"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            disabled={isSubmitting}
          />
          <Description className="text-xs">
            {t('integrations.sso.issuerHelp')}
          </Description>
        </Stack>

        <Stack gap={3}>
          <Input
            id="sso-client-id"
            label={t('integrations.sso.clientIdLabel')}
            placeholder={
              isConnected ? '••••••••••••••••' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
            }
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={isSubmitting}
          />
          <Description className="text-xs">
            {t('integrations.sso.clientIdHelp')}
          </Description>
        </Stack>

        <Stack gap={3}>
          <Input
            id="sso-client-secret"
            type="password"
            label={t('integrations.sso.clientSecretLabel')}
            placeholder={isConnected ? '••••••••••••••••' : ''}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={isSubmitting}
          />
          <Description className="text-xs">
            {t('integrations.sso.clientSecretHelp')}
          </Description>
        </Stack>

        <Stack gap={3}>
          <HStack justify="between" className="py-2">
            <Label htmlFor="auto-provision-toggle">
              {t('integrations.sso.autoProvisionLabel')}
            </Label>
            <Switch
              id="auto-provision-toggle"
              checked={autoProvisionEnabled}
              onCheckedChange={setAutoProvisionEnabled}
              disabled={isSubmitting}
            />
          </HStack>
          <Description className="text-xs">
            {t('integrations.sso.autoProvisionHelp')}
          </Description>
        </Stack>

        {autoProvisionEnabled && (
          <>
            <Stack gap={3}>
              <Input
                id="sso-exclude-groups"
                label={t('integrations.sso.excludeGroupsLabel')}
                placeholder="All-Employees, Domain-Users"
                value={excludeGroups}
                onChange={(e) => setExcludeGroups(e.target.value)}
                disabled={isSubmitting}
              />
              <Description className="text-xs">
                {t('integrations.sso.excludeGroupsHelp')}
              </Description>
            </Stack>

            <Stack gap={3}>
              <HStack justify="between" className="py-2">
                <Label htmlFor="sync-mode-toggle">
                  {t('integrations.sso.syncModeLabel')}
                </Label>
                <Switch
                  id="sync-mode-toggle"
                  checked={teamMembershipMode === 'sync'}
                  onCheckedChange={(checked) =>
                    setTeamMembershipMode(checked ? 'sync' : 'additive')
                  }
                  disabled={isSubmitting}
                />
              </HStack>
              <Description className="text-xs">
                {teamMembershipMode === 'sync'
                  ? t('integrations.sso.syncModeHelp')
                  : t('integrations.sso.additiveModeHelp')}
              </Description>
            </Stack>
          </>
        )}
      </Stack>
    </FormDialog>
  );
}
