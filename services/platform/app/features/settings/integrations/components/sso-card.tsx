'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Switch } from '@/app/components/ui/forms/switch';
import { Button } from '@/app/components/ui/primitives/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription,
} from '@/app/components/ui/layout/card';
import { Stack, HStack, Center } from '@/app/components/ui/layout/layout';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Settings } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { SSOConfigDialog } from './sso-config-dialog';

type PlatformRole = 'admin' | 'developer' | 'editor' | 'member' | 'disabled';

type RoleMappingRule = {
  source: 'jobTitle' | 'appRole';
  pattern: string;
  targetRole: PlatformRole;
};

interface SSOProvider {
  _id: string;
  providerId: string;
  issuer: string;
  clientId?: string;
  scopes: string[];
  autoProvisionTeam: boolean;
  excludeGroups: string[];
  autoProvisionRole: boolean;
  roleMappingRules: RoleMappingRule[];
  defaultRole: PlatformRole;
  enableOneDriveAccess: boolean;
}

interface SSOCardProps {
  organizationId: string;
  ssoProvider: SSOProvider | null;
  onConfigured?: () => void;
}

export function SSOCard({
  organizationId,
  ssoProvider,
  onConfigured,
}: SSOCardProps) {
  const { t } = useT('settings');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const isConnected = !!ssoProvider;

  const handleSwitchToggle = (checked: boolean) => {
    if (checked || isConnected) {
      setIsDialogOpen(true);
    }
  };

  const handleDialogClose = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      onConfigured?.();
    }
  };

  return (
    <>
      <Card className="flex flex-col justify-between">
        <CardContent className="p-5">
          <Stack gap={3}>
            <Center className="w-11 h-11 border border-border rounded-md">
              <KeyRound className="size-6" />
            </Center>
            <Stack gap={1}>
              <HStack gap={2}>
                <CardTitle className="text-base">
                  {t('integrations.sso.name')}
                </CardTitle>
                {isConnected && (
                  <Badge variant="green" className="text-xs">
                    {t('integrations.sso.connected')}
                  </Badge>
                )}
              </HStack>
              <CardDescription>
                {t('integrations.sso.description')}
              </CardDescription>
            </Stack>
          </Stack>
        </CardContent>

        <CardFooter className="border-t border-border px-5 py-4">
          <HStack justify="between" className="w-full">
            <Button
              variant="link"
              size="sm"
              onClick={() => setIsDialogOpen(true)}
              className="flex items-center gap-1 text-sm h-6"
            >
              <Settings className="size-4" />
              {t('integrations.manage')}
            </Button>
            <Switch
              checked={isConnected}
              onCheckedChange={handleSwitchToggle}
            />
          </HStack>
        </CardFooter>
      </Card>

      <SSOConfigDialog
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        organizationId={organizationId}
        existingProvider={ssoProvider}
      />
    </>
  );
}
