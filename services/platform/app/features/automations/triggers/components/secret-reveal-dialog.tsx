'use client';

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Field } from '@/app/components/ui/forms/field';
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
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20"
          role="alert"
        >
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {warning}
          </p>
        </div>
        {secrets.map((secret, index) => (
          <Field key={secret.label} label={secret.label}>
            <div className="relative">
              <code className="bg-muted block w-full rounded-md p-3 pr-12 font-mono text-sm break-all">
                {secret.value}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(secret.value, index)}
                className="absolute top-1/2 right-2 -translate-y-1/2"
                aria-label={`Copy ${secret.label}`}
              >
                {copiedIndex === index ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </Field>
        ))}
      </Stack>
    </FormDialog>
  );
}
