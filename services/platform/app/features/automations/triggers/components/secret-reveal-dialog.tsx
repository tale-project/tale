'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface SecretField {
  label: string;
  value: string;
}

interface SecretRevealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  warning: string;
  secrets: SecretField[];
}

export function SecretRevealDialog({
  open,
  onOpenChange,
  title,
  warning,
  secrets,
}: SecretRevealDialogProps) {
  const { t: tCommon } = useT('common');
  const { t } = useT('automations');
  const { toast } = useToast();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIndex(index);
      toast({ title: t('triggers.common.copied'), variant: 'success' });
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  const handleClose = () => {
    setCopiedIndex(null);
    onOpenChange(false);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleClose}
      title={title}
      submitText={tCommon('actions.done')}
      isSubmitting={false}
      onSubmit={handleClose}
      customFooter={
        <Button type="button" onClick={handleClose}>
          {tCommon('actions.done')}
        </Button>
      }
    >
      <Stack gap={4}>
        <div
          className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3"
          role="alert"
        >
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {warning}
          </p>
        </div>
        {secrets.map((secret, index) => (
          <Stack key={secret.label} gap={1}>
            <span className="text-sm font-medium text-foreground">
              {secret.label}
            </span>
            <div className="relative">
              <code className="block w-full p-3 pr-12 bg-muted rounded-md font-mono text-sm break-all">
                {secret.value}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(secret.value, index)}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                aria-label={`Copy ${secret.label}`}
              >
                {copiedIndex === index ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </Stack>
        ))}
      </Stack>
    </FormDialog>
  );
}
