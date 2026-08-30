'use client';

import { Button } from '@tale/ui/button';
import { useCallback, useState } from 'react';

import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface GoogleDisconnectButtonProps {
  className?: string;
  onDisconnected?: () => void;
}

/**
 * Revokes the signed-in member's Knowledge cloud-import grant for Google Drive.
 * The import dialog closes and the compact connect dialog opens.
 */
export function GoogleDisconnectButton({
  className,
  onDisconnected,
}: GoogleDisconnectButtonProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const [isLoading, setIsLoading] = useState(false);
  const organizationId = useOrganizationId();
  const { mutateAsync: revokeAuthorization } = useBackendMutation(
    'cloud_import/mutations:revokeAuthorization',
  );

  const handleDisconnect = useCallback(async () => {
    if (!organizationId) return;
    setIsLoading(true);
    try {
      await revokeAuthorization({
        organizationId,
        provider: 'google-drive',
      });
      onDisconnected?.();
    } catch (error) {
      console.error('Failed to disconnect Google Drive:', error);
      toast({
        title: t('googledrive.disconnectFailed'),
        description:
          error instanceof Error ? error.message : tCommon('errors.generic'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, onDisconnected, revokeAuthorization, t, tCommon]);

  return (
    <Button
      type="button"
      onClick={handleDisconnect}
      disabled={isLoading || !organizationId}
      className={className}
      variant="ghost"
    >
      {isLoading ? t('googledrive.disconnecting') : t('googledrive.disconnect')}
    </Button>
  );
}
