'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isValidAgentSlug } from '@/lib/shared/schemas/agents';

import { useSaveAgent } from '../hooks/mutations';

/**
 * Create an agent: pick its slug (the immutable identity — file stem AND
 * frontmatter `name`) and the display name people see in chat. `saveAgent`
 * is an upsert keyed by slug, so creating over an existing slug would
 * silently edit it — refuse client-side when the slug is already taken.
 * A new agent starts `private` (its author's own); sharing is an explicit
 * edit on the General tab.
 */
export function AgentCreateDialog({
  organizationId,
  open,
  onOpenChange,
  onCreated,
  existingSlugs,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
  existingSlugs?: readonly string[];
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const saveAgent = useSaveAgent();

  const trimmedSlug = slug.trim();
  const slugInvalid = trimmedSlug.length > 0 && !isValidAgentSlug(trimmedSlug);
  const slugTaken = !!existingSlugs?.includes(trimmedSlug);
  const canSubmit =
    trimmedSlug.length > 0 &&
    !slugInvalid &&
    !slugTaken &&
    displayName.trim().length > 0 &&
    !saveAgent.isPending;

  const slugHelp = slugTaken
    ? t('agents.agentAlreadyExists')
    : t('agents.form.nameHelp');

  const reset = () => {
    setSlug('');
    setDisplayName('');
    setDescription('');
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await saveAgent.mutateAsync({
        organizationId,
        slug: trimmedSlug,
        displayName: displayName.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      toast({ title: t('agents.agentCreated'), variant: 'success' });
      reset();
      onCreated(trimmedSlug);
    } catch (error) {
      console.error('Failed to create agent', error);
      toast({ title: t('agents.agentCreateFailed'), variant: 'destructive' });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('agents.createAgent')}
    >
      <Stack gap={4}>
        <Stack gap={1}>
          <label htmlFor="agent-create-slug" className="text-sm font-medium">
            {t('agents.form.name')}
          </label>
          <Input
            id="agent-create-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('agents.form.namePlaceholder')}
            aria-invalid={slugInvalid || slugTaken}
            aria-describedby="agent-create-slug-help"
            autoFocus
          />
          <p
            id="agent-create-slug-help"
            className={
              slugInvalid || slugTaken
                ? 'text-destructive text-xs'
                : 'text-muted-foreground text-xs'
            }
          >
            {slugHelp}
          </p>
        </Stack>
        <Stack gap={1}>
          <label
            htmlFor="agent-create-display-name"
            className="text-sm font-medium"
          >
            {t('agents.form.displayName')}
          </label>
          <Input
            id="agent-create-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('agents.form.displayNamePlaceholder')}
          />
        </Stack>
        <Stack gap={1}>
          <label
            htmlFor="agent-create-description"
            className="text-sm font-medium"
          >
            {t('agents.form.description')}
          </label>
          <Input
            id="agent-create-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('agents.form.descriptionPlaceholder')}
          />
        </Stack>
        <Row gap={2} justify="end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tCommon('actions.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {saveAgent.isPending
              ? t('agents.createDialog.creating')
              : t('agents.createAgent')}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}
