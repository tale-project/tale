'use client';

import { Button } from '@tale/ui/button';
import { useCallback, useState } from 'react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface MicrosoftDisconnectButtonProps {
  className?: string;
  onDisconnected?: () => void;
}

/**
 * Revokes the signed-in member's Knowledge cloud-import grant for Microsoft
 * 365. The import dialog closes and the compact connect dialog opens.
 */
export function MicrosoftDisconnectButton({
  className,
  onDisconnected,
}: MicrosoftDisconnectButtonProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const [isLoading, setIsLoading] = useState(false);
  const organizationId = useOrganizationId();
  const { mutateAsync: revokeAuthorization } = useConvexMutation(
    'cloud_import/mutations:revokeAuthorization',
  );

  const handleDisconnect = useCallback(async () => {
    if (!organizationId) return;
    setIsLoading(true);
    try {
      await revokeAuthorization({
        organizationId,
        provider: 'onedrive',
      });
      onDisconnected?.();
    } catch (error) {
      console.error('Failed to disconnect Microsoft 365:', error);
      toast({
        title: t('onedrive.disconnectFailed'),
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
      {isLoading ? t('onedrive.disconnecting') : t('onedrive.disconnect')}
    </Button>
  );
}
