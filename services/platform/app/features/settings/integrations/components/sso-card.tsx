'use client';

import { KeyRound, Settings } from 'lucide-react';
import { useState } from 'react';

import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Switch } from '@/app/components/ui/forms/switch';
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription,
} from '@/app/components/ui/layout/card';
import { Stack, HStack, Center } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import { SSOConfigDialog } from './sso-config-dialog';

interface SSOCardProps {
  organizationId: string;
  ssoProvider: SsoProvider | null;
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
            <Center className="border-border h-11 w-11 rounded-md border">
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

        <CardFooter className="border-border border-t px-5 py-4">
          <HStack justify="between" className="w-full">
            <Button
              variant="link"
              size="sm"
              onClick={() => setIsDialogOpen(true)}
              className="flex h-6 items-center gap-1 text-sm"
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
