'use client';

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import type { RefObject } from 'react';

import { useT } from '@/lib/i18n/client';

import { CodingAgentSetup } from './coding-agent-setup';
import { SetupDialogFooter } from './setup-dialog-footer';

interface ConnectAgentDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus returns when the opener has moved on (a button that left the
   * page when the list stopped being empty). */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Connecting a coding agent, from the page that lists them: the commands for
 * the agent in use, whether it has signed in yet, and what to say to it
 * first. The agent's browser sign-in does the rest.
 */
export function ConnectAgentDialog({
  organizationId,
  open,
  onOpenChange,
  restoreFocusRef,
}: ConnectAgentDialogProps) {
  const { t } = useT('codingAgent');
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-xl"
        {...(restoreFocusRef === undefined ? {} : { restoreFocusRef })}
      >
        <ResponsiveDialogTitle>{t('dialog.title')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('dialog.description')}
        </ResponsiveDialogDescription>
        <CodingAgentSetup
          organizationId={organizationId}
          promptContext={{ kind: 'general' }}
        />
        <SetupDialogFooter />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
