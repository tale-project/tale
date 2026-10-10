'use client';

import { Button, buttonVariants } from '@tale/ui/button';
import { CopyableField } from '@tale/ui/copyable-field';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { TALE_DOCS_URL } from '@tale/ui/seo/globals';
import { Link } from '@tanstack/react-router';
import { BookOpen, Bot, PlugZap } from 'lucide-react';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * The way to change an automation: a coding agent (Claude Code, Codex,
 * Cursor) connected to Tale's MCP server reads it, changes it, checks it and
 * saves a new version, which the editor then shows. The canvas is not where
 * an automation is built; its fields take small edits.
 *
 * `CodingAgentButton` opens `CodingAgentDialog`: the automation's name to
 * hand the agent, the way to set up MCP, and the guide to connecting one.
 * It sits last among the canvas's own verbs and is the first action of an
 * empty automation.
 */
export function CodingAgentButton({
  organizationId,
  automationSlug,
  variant = 'toolbar',
}: {
  organizationId: string;
  automationSlug: string;
  /** `toolbar`: a secondary button that keeps only its icon on a phone;
   *  `primary`: the main action of an empty automation. */
  variant?: 'toolbar' | 'primary';
}) {
  const { t } = useT('automations');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant === 'primary' ? 'primary' : 'secondary'}
        size={variant === 'primary' ? 'default' : 'sm'}
        icon={Bot}
        collapseLabel={variant === 'toolbar'}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t('codingAgent.button')}
      </Button>
      <CodingAgentDialog
        open={open}
        onOpenChange={setOpen}
        organizationId={organizationId}
        automationSlug={automationSlug}
      />
    </>
  );
}

function CodingAgentDialog({
  open,
  onOpenChange,
  organizationId,
  automationSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  automationSlug: string;
}) {
  const { t } = useT('automations');
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex flex-col gap-4">
        <ResponsiveDialogTitle>{t('codingAgent.button')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('codingAgent.body')}
        </ResponsiveDialogDescription>
        <CopyableField
          label={t('codingAgent.nameLabel')}
          value={automationSlug}
          mono
        />
        <div className="flex flex-wrap gap-2">
          <Link
            to="/dashboard/$id/settings/api/mcp"
            params={{ id: organizationId }}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <PlugZap className="mr-2 size-4" aria-hidden="true" />
            {t('codingAgent.setUp')}
          </Link>
          <a
            href={`${TALE_DOCS_URL}/develop/mcp-endpoint`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <BookOpen className="mr-2 size-4" aria-hidden="true" />
            {t('codingAgent.learnMore')}
          </a>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
