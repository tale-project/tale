'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GmailIcon, OutlookIcon } from '@/components/ui/icons';
import { DialogProps } from '@radix-ui/react-dialog';
import { Mail, ChevronRight } from 'lucide-react';
import GmailCreateProviderDialog from './gmail-create-provider-dialog';
import OutlookCreateProviderDialog from './outlook-create-provider-dialog';

interface EmailProviderTypeSelectorProps extends DialogProps {
  organizationId: string;
  onSuccess?: () => void;
}

export default function EmailProviderTypeSelector({
  organizationId,
  onSuccess,
  ...props
}: EmailProviderTypeSelectorProps) {
  const [showGmailDialog, setShowGmailDialog] = useState(false);
  const [showOutlookDialog, setShowOutlookDialog] = useState(false);

  const providerTypes = [
    {
      id: 'gmail',
      name: 'Gmail',
      description: 'Connect with OAuth2 (recommended) or app password',
      icon: GmailIcon,
      onClick: () => {
        setShowGmailDialog(true);
      },
    },
    {
      id: 'outlook',
      name: 'Outlook',
      description: 'Connect Microsoft Outlook or Office 365 account',
      icon: OutlookIcon,
      onClick: () => {
        setShowOutlookDialog(true);
      },
    },
    {
      id: 'custom',
      name: 'Custom SMTP',
      description: 'Configure a custom SMTP/IMAP email server',
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
      <Dialog {...props}>
        <DialogContent className="p-0">
          {/* Header */}
          <div className="border-b border-border px-4 py-6">
            <DialogHeader className="space-y-1">
              <DialogTitle>Choose Email Provider</DialogTitle>
            </DialogHeader>
          </div>

          {/* Content */}
          <div className="p-4 pt-2 space-y-2">
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
                            (Coming Soon)
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
          </div>
        </DialogContent>
      </Dialog>

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
