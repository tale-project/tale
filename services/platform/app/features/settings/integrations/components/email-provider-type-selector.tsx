'use client';

import { Mail, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { GmailIcon } from '@/app/components/icons/gmail-icon';
import { OutlookIcon } from '@/app/components/icons/outlook-icon';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

import { GmailCreateProviderDialog } from './gmail-create-provider-dialog';
import { OutlookCreateProviderDialog } from './outlook-create-provider-dialog';

interface EmailProviderTypeSelectorProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
  ssoProvider?: SsoProvider | null;
}

export function EmailProviderTypeSelector({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
  ssoProvider,
}: EmailProviderTypeSelectorProps) {
  const { t } = useT('settings');
  const [showGmailDialog, setShowGmailDialog] = useState(false);
  const [showOutlookDialog, setShowOutlookDialog] = useState(false);

  const providerTypes = [
    {
      id: 'gmail',
      name: t('integrations.providerGmail'),
      description: t('integrations.connectOAuth'),
      icon: GmailIcon,
      onClick: () => {
        setShowGmailDialog(true);
      },
    },
    {
      id: 'outlook',
      name: t('integrations.providerOutlook'),
      description: t('integrations.connectMicrosoft'),
      icon: OutlookIcon,
      onClick: () => {
        setShowOutlookDialog(true);
      },
    },
    {
      id: 'custom',
      name: t('integrations.customSMTP'),
      description: t('integrations.configureCustom'),
      icon: Mail,
      onClick: () => {
        // TODO: Open custom SMTP/IMAP dialog when implemented
        console.log('Custom SMTP/IMAP not yet implemented');
      },
      disabled: true,
    },
  ];

  return (
    <>
      <ViewDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('integrations.chooseEmailProvider')}
      >
        <Stack gap={2}>
          {providerTypes.map((provider) => {
            const IconComponent = provider.icon;
            return (
              <button
                key={provider.id}
                onClick={provider.onClick}
                disabled={provider.disabled}
                className="bg-background border-border hover:bg-muted group disabled:hover:bg-background flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-start gap-3">
                  <div className="bg-background border-border flex size-10 flex-shrink-0 items-center justify-center rounded-md border">
                    <IconComponent className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-foreground mb-0.5 text-sm font-medium">
                      {provider.name}
                      {provider.disabled && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          {t('integrations.comingSoon')}
                        </span>
                      )}
                    </h3>
                    <p className="text-muted-foreground text-xs">
                      {provider.description}
                    </p>
                  </div>
                </div>
                {!provider.disabled && (
                  <ChevronRight className="text-muted-foreground group-hover:text-foreground size-5 flex-shrink-0 transition-colors" />
                )}
              </button>
            );
          })}
        </Stack>
      </ViewDialog>

      <GmailCreateProviderDialog
        open={showGmailDialog}
        onOpenChange={setShowGmailDialog}
        organizationId={organizationId}
        onSuccess={() => {
          setShowGmailDialog(false);
          onSuccess?.();
        }}
      />

      <OutlookCreateProviderDialog
        open={showOutlookDialog}
        onOpenChange={setShowOutlookDialog}
        organizationId={organizationId}
        ssoProvider={ssoProvider}
        onSuccess={() => {
          setShowOutlookDialog(false);
          onSuccess?.();
        }}
      />
    </>
  );
}
