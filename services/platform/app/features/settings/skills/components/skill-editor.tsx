'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfigIcon as SkillIcon } from '@/app/components/catalog/config-icon';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
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
 * skills — `canEdit` is computed server-side). Saving runs through the
 * settings header's global Save/Discard cluster; Delete stays local as a
 * dialog-confirmed destructive action.
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

  const [deleteOpen, setDeleteOpen] = useState(false);

  const skill = skillQuery.data;

  const data = useMemo<SkillFormState | undefined>(() => {
    if (!skill) return undefined;
    return {
      description: skill.description,
      body: skill.body,
      visibility: skill.visibility,
      labels: (skill.labels ?? []).join(', '),
    };
  }, [skill]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure. Delete stays a local, dialog-confirmed action and keeps its own
  // toasts.
  const save = useCallback(
    async (values: SkillFormState) => {
      const labels = values.labels
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
      try {
        await saveSkill.mutateAsync({
          organizationId,
          slug,
          description: values.description.trim(),
          body: values.body,
          visibility: values.visibility,
          labels,
        });
      } catch (error) {
        console.error('Failed to save skill', error);
        throw new Error(t('skills.editor.saveFailed'), { cause: error });
      }
    },
    [organizationId, saveSkill, slug, t],
  );

  const editor = useFormEditor<SkillFormState>({ data, save });
  useRegisterGroupedEditor(editor, {
    enabled: skill != null && skill.canEdit,
  });
  const { register, watch, setValue } = editor.form;

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
          <Button variant="secondary" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="text-destructive mr-1 size-4" />
            {tCommon('actions.delete')}
          </Button>
        )}
      </Row>

      {readOnly && <Alert description={t('skills.readOnly')} />}

      <form onSubmit={editor.submit}>
        <Stack gap={4}>
          <Stack gap={1}>
            <label htmlFor="skill-description" className="text-sm font-medium">
              {t('skills.form.description')}
            </label>
            <Input
              id="skill-description"
              disabled={readOnly}
              aria-describedby="skill-description-help"
              {...register('description')}
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
              value={watch('visibility') ?? 'org'}
              onValueChange={(visibility) => {
                if (visibility === 'private' || visibility === 'org') {
                  setValue('visibility', visibility, { shouldDirty: true });
                }
              }}
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
              disabled={readOnly}
              placeholder={t('skills.editor.labelsPlaceholder')}
              aria-describedby="skill-labels-help"
              {...register('labels')}
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
              disabled={readOnly}
              rows={18}
              className="font-mono text-sm"
              aria-describedby="skill-body-help"
              {...register('body')}
            />
            <p id="skill-body-help" className="text-muted-foreground text-xs">
              {t('skills.editor.bodyHelp')}
            </p>
          </Stack>
        </Stack>
      </form>

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
