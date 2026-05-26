'use client';

import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { Share, SquarePlus } from 'lucide-react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useT } from '@/lib/i18n/client';

export interface IosInstallSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Add to Home Screen" instructions for iOS, where the browser never fires
 * `beforeinstallprompt` so there's no programmatic install. Rendered as a
 * bottom sheet on mobile (via the shared Dialog) — the only place this is
 * reachable, since the trigger is gated on `useInstallPrompt().isIOS`.
 */
export function IosInstallSheet({ open, onOpenChange }: IosInstallSheetProps) {
  const { t } = useT('auth');

  const steps: { icon: typeof Share; text: string }[] = [
    { icon: Share, text: t('userButton.iosInstall.step1') },
    { icon: SquarePlus, text: t('userButton.iosInstall.step2') },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('userButton.iosInstall.title')}
      description={t('userButton.iosInstall.description')}
      footer={
        <Button type="button" onClick={() => onOpenChange(false)}>
          {t('userButton.iosInstall.done')}
        </Button>
      }
    >
      <ol className="mt-2 flex flex-col gap-3">
        {steps.map((step, index) => {
          const StepIcon = step.icon;
          return (
            <li key={index} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-xl"
              >
                <StepIcon className="size-4" />
              </span>
              <Text as="span" className="text-sm">
                {step.text}
              </Text>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}
