'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ConfigIcon as SkillIcon } from '@/app/components/catalog/config-icon';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteSkill, useSaveSkill } from '../hooks/mutations';
import { useSkill } from '../hooks/queries';

interface SkillFormState {
  description: string;
  body: string;
  visibility: 'private' | 'org';
  labels: string;
}

/**
 * Edit one skill's `SKILL.md`: description (what tells the model when to read
 * it), the markdown body, visibility, and labels. The slug is immutable
 * identity (directory name = frontmatter `name`) — renaming is create+delete
 * on purpose. Saving posts only the fields this form carries; the server
 * merges over the on-disk file, so frontmatter the editor doesn't know
 * (license, icon, recommended-packages, custom keys) survives untouched.
 * Read-only for viewers without edit rights (owner, or org-admin for org
 * skills — `canEdit` is computed server-side).
 */
export function SkillEditor({
  organizationId,
  slug,
  onBack,
  onDeleted,
}: {
  organizationId: string;
  slug: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const skillQuery = useSkill(organizationId, slug);
  const saveSkill = useSaveSkill();
  const deleteSkill = useDeleteSkill();

  const [form, setForm] = useState<SkillFormState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const skill = skillQuery.data;

  // Seed the form once per loaded document; a reactive refetch must not
  // clobber in-progress edits, so only a null form adopts server state.
  useEffect(() => {
    if (skill && form === null) {
      setForm({
        description: skill.description,
        body: skill.body,
        visibility: skill.visibility,
        labels: (skill.labels ?? []).join(', '),
      });
    }
  }, [skill, form]);

  if (skillQuery.isPending) {
    return (
      <Skeletonize loading>
        <SkeletonBox fullWidth>
          <div className="h-96 w-full rounded-lg" />
        </SkeletonBox>
      </Skeletonize>
    );
  }

  if (skillQuery.isError || skill == null) {
    return (
      <Stack gap={3}>
        <BackButton onBack={onBack} label={t('skills.backToList')} />
        <Alert
          variant="destructive"
          description={
            skillQuery.isError ? t('skills.listFailed') : t('skills.notFound')
          }
        />
      </Stack>
    );
  }

  const readOnly = !skill.canEdit;

  const submit = async () => {
    if (!form || readOnly) return;
    const labels = form.labels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
    try {
      await saveSkill.mutateAsync({
        organizationId,
        slug,
        description: form.description.trim(),
        body: form.body,
        visibility: form.visibility,
        labels,
      });
      toast({ title: t('skills.editor.saveSuccess'), variant: 'success' });
    } catch (error) {
      console.error('Failed to save skill', error);
      toast({ title: t('skills.editor.saveFailed'), variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteSkill.mutateAsync({ organizationId, slug });
      setDeleteOpen(false);
      toast({ title: t('skills.skillDeleted'), variant: 'success' });
      onDeleted();
    } catch (error) {
      console.error('Failed to delete skill', error);
      toast({ title: t('skills.skillDeleteFailed'), variant: 'destructive' });
    }
  };

  return (
    <Stack gap={5}>
      <Row gap={3} justify="between" align="center">
        <HStack gap={3} align="center" className="min-w-0">
          <BackButton onBack={onBack} label={t('skills.backToList')} />
          <SkillIcon icon={skill.icon} className="size-6" />
          <Text as="h3" className="truncate font-semibold">
            {slug}
          </Text>
          {skill.visibility === 'private' && (
            <Badge variant="outline">{t('skills.visibility.private')}</Badge>
          )}
        </HStack>
        {!readOnly && (
          <HStack gap={2}>
            <Button variant="secondary" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="text-destructive mr-1 size-4" />
              {tCommon('actions.delete')}
            </Button>
            <Button
              disabled={saveSkill.isPending || !form}
              onClick={() => void submit()}
            >
              {saveSkill.isPending
                ? tCommon('actions.saving')
                : tCommon('actions.save')}
            </Button>
          </HStack>
        )}
      </Row>

      {readOnly && <Alert description={t('skills.readOnly')} />}

      <Stack gap={4}>
        <Stack gap={1}>
          <label htmlFor="skill-description" className="text-sm font-medium">
            {t('skills.form.description')}
          </label>
          <Input
            id="skill-description"
            value={form?.description ?? ''}
            onChange={(e) =>
              setForm((f) => (f ? { ...f, description: e.target.value } : f))
            }
            disabled={readOnly}
            aria-describedby="skill-description-help"
          />
          <p
            id="skill-description-help"
            className="text-muted-foreground text-xs"
          >
            {t('skills.editor.descriptionHelp')}
          </p>
        </Stack>

        <Stack gap={1}>
          <span className="text-sm font-medium">
            {t('skills.visibility.label')}
          </span>
          <RadioGroup
            aria-label={t('skills.visibility.label')}
            value={form?.visibility ?? 'org'}
            onValueChange={(visibility) =>
              setForm((f) =>
                f && (visibility === 'private' || visibility === 'org')
                  ? { ...f, visibility }
                  : f,
              )
            }
            options={[
              {
                value: 'org',
                label: t('skills.visibility.org'),
                description: t('skills.visibility.orgHelp'),
              },
              {
                value: 'private',
                label: t('skills.visibility.private'),
                description: t('skills.visibility.privateHelp'),
              },
            ]}
            disabled={readOnly}
          />
        </Stack>

        <Stack gap={1}>
          <label htmlFor="skill-labels" className="text-sm font-medium">
            {t('skills.editor.labels')}
          </label>
          <Input
            id="skill-labels"
            value={form?.labels ?? ''}
            onChange={(e) =>
              setForm((f) => (f ? { ...f, labels: e.target.value } : f))
            }
            disabled={readOnly}
            placeholder={t('skills.editor.labelsPlaceholder')}
            aria-describedby="skill-labels-help"
          />
          <p id="skill-labels-help" className="text-muted-foreground text-xs">
            {t('skills.editor.labelsHelp')}
          </p>
        </Stack>

        <Stack gap={1}>
          <label htmlFor="skill-body" className="text-sm font-medium">
            {t('skills.section.body')}
          </label>
          <Textarea
            id="skill-body"
            value={form?.body ?? ''}
            onChange={(e) =>
              setForm((f) => (f ? { ...f, body: e.target.value } : f))
            }
            disabled={readOnly}
            rows={18}
            className="font-mono text-sm"
            aria-describedby="skill-body-help"
          />
          <p id="skill-body-help" className="text-muted-foreground text-xs">
            {t('skills.editor.bodyHelp')}
          </p>
        </Stack>
      </Stack>

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('skills.deleteSkill')}
        description={t('skills.deleteConfirmation')}
        onDelete={() => void confirmDelete()}
        isDeleting={deleteSkill.isPending}
      />
    </Stack>
  );
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon" onClick={onBack} title={label}>
      <ArrowLeft className="text-muted-foreground size-5" />
    </Button>
  );
}
