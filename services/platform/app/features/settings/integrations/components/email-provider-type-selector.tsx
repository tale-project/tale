'use client';

import { useState } from 'react';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { GmailIcon } from '@/app/components/icons/gmail-icon';
import { OutlookIcon } from '@/app/components/icons/outlook-icon';
import { Mail, ChevronRight } from 'lucide-react';
import { GmailCreateProviderDialog } from './gmail-create-provider-dialog';
import { OutlookCreateProviderDialog } from './outlook-create-provider-dialog';
import { useT } from '@/lib/i18n/client';

interface EmailProviderTypeSelectorProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

export function EmailProviderTypeSelector({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
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
        // TODO: Open custom SMTP dialog when implemented
        console.log('Custom SMTP not yet implemented');
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
                className="w-full bg-background border border-border rounded-lg p-4 hover:bg-muted transition-colors text-left flex items-center justify-between group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-background"
              >
                <div className="flex items-start gap-3">
                  <div className="size-10 bg-background border border-border rounded-md flex items-center justify-center flex-shrink-0">
                    <IconComponent className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-sm text-foreground mb-0.5">
                      {provider.name}
                      {provider.disabled && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t('integrations.comingSoon')}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {provider.description}
                    </p>
                  </div>
                </div>
                {!provider.disabled && (
                  <ChevronRight className="size-5 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                )}
              </button>
            );
          })}
        </Stack>
      </ViewDialog>

      {/* Gmail Create Dialog */}
      <GmailCreateProviderDialog
        open={showGmailDialog}
        onOpenChange={setShowGmailDialog}
        organizationId={organizationId}
        onSuccess={() => {
          setShowGmailDialog(false);
          onSuccess?.();
        }}
      />

      {/* Outlook Create Dialog */}
      <OutlookCreateProviderDialog
        open={showOutlookDialog}
        onOpenChange={setShowOutlookDialog}
        organizationId={organizationId}
        onSuccess={() => {
          setShowOutlookDialog(false);
          onSuccess?.();
        }}
      />
    </>
  );
}
