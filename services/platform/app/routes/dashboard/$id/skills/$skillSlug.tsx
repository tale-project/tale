import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { SkillAssetsSection } from '@/app/features/skills/components/skill-assets-section';
import { useUpdateSkill } from '@/app/features/skills/hooks/mutations';
import {
  useListSkillFiles,
  useReadSkill,
} from '@/app/features/skills/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/skills/$skillSlug')({
  head: () => ({
    meta: seo('skills'),
  }),
  component: SkillDetailPage,
});

function SkillDetailPage() {
  const { id: organizationId, skillSlug } = Route.useParams();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useReadSkill(organizationId, skillSlug);
  const { data: filesData } = useListSkillFiles(organizationId, skillSlug);
  const { mutateAsync: updateSkill } = useUpdateSkill();

  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [hash, setHash] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const skill = data?.ok ? data : null;

  // Sync local form state with loaded skill content. We re-run only when the
  // hash changes so concurrent typing isn't clobbered by background refetch.
  useEffect(() => {
    if (!skill) return;
    if (skill.hash === hash) return;
    setDescription(skill.meta.description);
    setBody(skill.body);
    setHash(skill.hash);
  }, [skill, hash]);

  const handleSave = useCallback(async () => {
    if (!skill || isSaving) return;
    setIsSaving(true);
    try {
      const result = await updateSkill({
        organizationId,
        slug: skillSlug,
        meta: {
          ...skill.meta,
          description,
        },
        body,
        expectedHash: hash,
      });
      setHash(result.hash);
      toast({
        title: t('skills.skillSaved', { defaultValue: 'Skill saved' }),
        variant: 'success',
      });
      void queryClient.invalidateQueries({
        queryKey: ['config', 'skills', organizationId, skillSlug],
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'CONFLICT') {
          toast({
            title: t('skills.conflict', {
              defaultValue:
                'This skill was edited elsewhere. Reload to see the latest version.',
            }),
            variant: 'destructive',
          });
          void refetch();
          return;
        }
        if (code === 'INVALID_FRONTMATTER' || code === 'TOO_LARGE') {
          toast({
            title:
              error.data?.message ??
              t('skills.validationError', {
                defaultValue: 'Invalid skill configuration',
              }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error(error);
      toast({
        title: t('skills.skillSaveFailed', {
          defaultValue: 'Failed to save skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    skill,
    isSaving,
    updateSkill,
    organizationId,
    skillSlug,
    description,
    body,
    hash,
    t,
    refetch,
    queryClient,
  ]);

  if (isLoading) {
    return (
      <PageLayout>
        <ContentArea>
          <Skeleton className="h-24 w-full" />
        </ContentArea>
      </PageLayout>
    );
  }

  if (!skill) {
    const errorMessage = data && !data.ok ? data.message : undefined;
    return (
      <PageLayout>
        <ContentArea>
          <Stack gap={4} className="p-4">
            <Heading level={1}>
              {t('skills.notFound', { defaultValue: 'Skill not found' })}
            </Heading>
            {errorMessage ? <Text variant="muted">{errorMessage}</Text> : null}
            <Link
              to="/dashboard/$id/skills"
              params={{ id: organizationId }}
              className="underline"
            >
              {t('skills.backToList', {
                defaultValue: 'Back to skills',
              })}
            </Link>
          </Stack>
        </ContentArea>
      </PageLayout>
    );
  }

  const transitiveDeps =
    (skill.meta.toolNames?.length ?? 0) +
    (skill.meta.integrationBindings?.length ?? 0) +
    (skill.meta.workflowBindings?.length ?? 0);

  return (
    <PageLayout>
      <AdaptiveHeaderRoot>
        <HStack gap={2} align="center" className="p-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              void navigate({
                to: '/dashboard/$id/skills',
                params: { id: organizationId },
              })
            }
            aria-label={t('skills.backToList', { defaultValue: 'Back' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Heading level={1}>{skill.meta.name}</Heading>
        </HStack>
      </AdaptiveHeaderRoot>
      <ContentArea>
        <Stack gap={6} className="p-4">
          <FormSection
            label={t('skills.section.overview', { defaultValue: 'Overview' })}
          >
            <Stack gap={4}>
              <Input
                id="slug"
                label={t('skills.form.slug', { defaultValue: 'Slug' })}
                value={skill.meta.name}
                readOnly
              />
              <Textarea
                id="description"
                label={t('skills.form.description', {
                  defaultValue: 'Description',
                })}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
              <Text variant="caption">
                {t('skills.form.descriptionHelp', {
                  defaultValue:
                    'Lead with "Use when…". The agent reads this to decide whether to expand the skill.',
                })}
              </Text>
            </Stack>
          </FormSection>

          <FormSection
            label={t('skills.section.body', {
              defaultValue: 'Instructions (body)',
            })}
          >
            <Stack gap={2}>
              <Textarea
                id="body"
                label={t('skills.form.body', { defaultValue: 'Body markdown' })}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={18}
                className="font-mono text-sm"
              />
              <Text variant="caption">
                {t('skills.form.bodyHelp', {
                  defaultValue:
                    'Loaded into the agent context when it calls expand_skill. Plain markdown.',
                })}
              </Text>
            </Stack>
          </FormSection>

          <FormSection
            label={t('skills.section.bundle', {
              defaultValue: 'Bundle files',
            })}
          >
            <SkillAssetsSection
              organizationId={organizationId}
              skillSlug={skillSlug}
              assets={filesData?.assets ?? skill.assets ?? []}
              totalBytes={filesData?.totalBytes ?? skill.totalBytes ?? 0}
              maxTotalBytes={filesData?.maxTotalBytes ?? 1024 * 1024}
              maxAssets={filesData?.maxAssets ?? 32}
            />
          </FormSection>

          <FormSection
            label={t('skills.section.deps', {
              defaultValue: 'Declared dependencies',
            })}
          >
            <Stack gap={2}>
              <Text variant="body">
                {t('skills.deps.summary', {
                  defaultValue: '{count} declared dependencies',
                  count: transitiveDeps,
                })}
              </Text>
              {skill.meta.toolNames?.length ? (
                <Text variant="muted">
                  {t('skills.deps.tools', { defaultValue: 'Tools' })}:{' '}
                  {skill.meta.toolNames.join(', ')}
                </Text>
              ) : null}
              {skill.meta.integrationBindings?.length ? (
                <Text variant="muted">
                  {t('skills.deps.integrations', {
                    defaultValue: 'Integrations',
                  })}
                  : {skill.meta.integrationBindings.join(', ')}
                </Text>
              ) : null}
              {skill.meta.workflowBindings?.length ? (
                <Text variant="muted">
                  {t('skills.deps.workflows', { defaultValue: 'Workflows' })}:{' '}
                  {skill.meta.workflowBindings.join(', ')}
                </Text>
              ) : null}
              <Text variant="caption">
                {t('skills.deps.help', {
                  defaultValue:
                    'Edit declared dependencies in SKILL.md frontmatter (under tool-names / integration-bindings / workflow-bindings).',
                })}
              </Text>
            </Stack>
          </FormSection>

          <HStack gap={2} justify="end">
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              isLoading={isSaving}
              disabled={isSaving}
            >
              {tCommon('save')}
            </Button>
          </HStack>
        </Stack>
      </ContentArea>
    </PageLayout>
  );
}
