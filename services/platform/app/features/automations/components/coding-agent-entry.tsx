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

import { CodingAgentSetup } from '@/app/features/coding-agent/components/coding-agent-setup';
import { SetupDialogFooter } from '@/app/features/coding-agent/components/setup-dialog-footer';
import { useAgentConnectionAccess } from '@/app/features/settings/agent-connections/hooks/queries';
import { useT } from '@/lib/i18n/client';

/**
 * The way to change an automation: a coding agent (Claude Code, Codex,
 * Cursor) connected to Tale's MCP server reads it, changes it, checks it and
 * saves a new version, which the editor then shows. The canvas is not where
 * an automation is built; its fields take small edits.
 *
 * `CodingAgentButton` opens `CodingAgentDialog`: the guided setup, with a
 * prompt that names this automation. It sits last among the canvas's own verbs
 * and is the first action of an empty automation.
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
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-xl">
        <ResponsiveDialogTitle>{t('codingAgent.button')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('codingAgent.body')}
        </ResponsiveDialogDescription>
        <CodingAgentDialogBody
          organizationId={organizationId}
          automationSlug={automationSlug}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * What the dialog holds once it is open: the guided setup, with a prompt that
 * names this automation, while agents may sign in; where the operator turned
 * that off, the automation's name to hand an agent that holds a key and the
 * way to the MCP settings, which describe the key.
 */
function CodingAgentDialogBody({
  organizationId,
  automationSlug,
}: {
  organizationId: string;
  automationSlug: string;
}) {
  const { t } = useT('automations');
  const { data: access } = useAgentConnectionAccess(organizationId);
  if (access?.signInOn === false) {
    return (
      <>
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
      </>
    );
  }
  return (
    <>
      <CodingAgentSetup
        organizationId={organizationId}
        promptContext={{ kind: 'edit', name: automationSlug }}
      />
      <SetupDialogFooter />
    </>
  );
}
