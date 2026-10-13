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
 * What the dialog is about: the automation to change, or a failed run of it
 * to look into.
 */
type CodingAgentContext =
  | { readonly kind: 'edit'; readonly automationSlug: string }
  | {
      readonly kind: 'run';
      readonly automationSlug: string;
      readonly runId: string;
    };

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
        context={{ kind: 'edit', automationSlug }}
      />
    </>
  );
}

/**
 * The way on from a failed run: the same guided setup, with a prompt that
 * names the run, so the agent starts from its record — where it failed and
 * why — and proposes the smallest fix. It sits with the failure card's other
 * ways on.
 */
export function FixRunButton({
  organizationId,
  automationSlug,
  runId,
}: {
  organizationId: string;
  automationSlug: string;
  runId: string;
}) {
  const { t } = useT('automations');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={Bot}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t('codingAgent.fixAction')}
      </Button>
      <CodingAgentDialog
        open={open}
        onOpenChange={setOpen}
        organizationId={organizationId}
        context={{ kind: 'run', automationSlug, runId }}
      />
    </>
  );
}

function CodingAgentDialog({
  open,
  onOpenChange,
  organizationId,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  context: CodingAgentContext;
}) {
  const { t } = useT('automations');
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-xl">
        <ResponsiveDialogTitle>
          {context.kind === 'run'
            ? t('codingAgent.fixAction')
            : t('codingAgent.button')}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {context.kind === 'run'
            ? t('codingAgent.fixBody')
            : t('codingAgent.body')}
        </ResponsiveDialogDescription>
        <CodingAgentDialogBody
          organizationId={organizationId}
          context={context}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * What the dialog holds once it is open: the guided setup, with a prompt that
 * names this automation (and the run), while agents may sign in; where the
 * operator turned that off, the name (and the run's id) to hand an agent that
 * holds a key and the way to the MCP settings, which describe the key.
 */
function CodingAgentDialogBody({
  organizationId,
  context,
}: {
  organizationId: string;
  context: CodingAgentContext;
}) {
  const { t } = useT('automations');
  const { data: access } = useAgentConnectionAccess(organizationId);
  if (access?.signInOn === false) {
    return (
      <>
        <CopyableField
          label={t('codingAgent.nameLabel')}
          value={context.automationSlug}
          mono
        />
        {context.kind === 'run' && (
          <CopyableField
            label={t('codingAgent.runLabel')}
            value={context.runId}
            mono
          />
        )}
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
        promptContext={
          context.kind === 'run'
            ? {
                kind: 'run',
                name: context.automationSlug,
                runId: context.runId,
              }
            : { kind: 'edit', name: context.automationSlug }
        }
      />
      <SetupDialogFooter />
    </>
  );
}
