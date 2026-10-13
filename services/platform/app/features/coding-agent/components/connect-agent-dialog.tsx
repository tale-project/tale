'use client';

import { Button } from '@tale/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { TALE_DOCS_URL } from '@tale/ui/seo/globals';
import { ExternalLink } from 'lucide-react';
import type { RefObject } from 'react';

import { useT } from '@/lib/i18n/client';

import { CodingAgentSetup } from './coding-agent-setup';

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
        <div className="flex items-center justify-between gap-3">
          <a
            href={`${TALE_DOCS_URL}/develop/use-tale-from-your-editor`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm underline underline-offset-2"
          >
            {t('dialog.guide')}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="secondary">
              {t('dialog.done')}
            </Button>
          </ResponsiveDialogClose>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
