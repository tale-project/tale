'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { useDuplicateSkill } from '@/app/features/skills/hooks/mutations';
import {
  useGetSkillAuditHistory,
  useListSkillFiles,
  useReadSkill,
} from '@/app/features/skills/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format-bytes';

import { SkillAssetViewer } from './skill-asset-viewer';
import { SkillBundleTreePanel } from './skill-bundle-tree-panel';
import { SkillDeleteDialog } from './skill-delete-dialog';

interface SkillDetailPanelProps {
  organizationId: string;
  slug: string;
  onOpenChange: (open: boolean) => void;
  /** Re-point the panel at a different skill (used after duplicate). */
  onSwitchSlug: (slug: string) => void;
}

export function SkillDetailPanel({
  organizationId,
  slug,
  onOpenChange,
  onSwitchSlug,
}: SkillDetailPanelProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const queryClient = useQueryClient();
  const { locale } = useLocale();

  const { data, isLoading } = useReadSkill(organizationId, slug);
  const { data: filesData } = useListSkillFiles(organizationId, slug);

  const { data: auditRows } = useGetSkillAuditHistory(organizationId, slug);
  const { mutateAsync: duplicateSkill } = useDuplicateSkill();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  // File selection in the bundle tree. Lives in component state — no URL
  // mirror, since the panel itself has no route.
  const [selectedFile, setSelectedFile] = useState('SKILL.md');

  const skill = data?.ok ? data : null;
  const hash = skill?.hash;

  // Reset selected file whenever the panel is re-pointed at a different
  // skill — otherwise switching from skill-A?file=scripts/x.py to skill-B
  // would render skill-B through the asset viewer with skill-A's path.
  useEffect(() => {
    setSelectedFile('SKILL.md');
  }, [slug]);

  const handleDuplicate = useCallback(async () => {
    if (!skill || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const { newSlug } = await duplicateSkill({
        organizationId,
        slug,
      });
      toast({
        title: t('skills.skillDuplicated', {
          defaultValue: 'Skill duplicated as {slug}',
          slug: newSlug,
        }),
        variant: 'success',
      });
      onSwitchSlug(newSlug);
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.skillDuplicateFailed', {
          defaultValue: 'Failed to duplicate skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  }, [
    skill,
    isDuplicating,
    duplicateSkill,
    organizationId,
    slug,
    onSwitchSlug,
    t,
  ]);

  const skillDisplayName = skill?.meta.name ?? slug;
  const errorMessage = data && !data.ok ? data.message : undefined;
  const description = skill?.meta.description ?? '';
  const body = skill?.body ?? '';

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) onOpenChange(false);
        }}
        resize={{
          defaultWidthPx: 768,
          minWidthPx: 480,
          maxWidthPx: 1400,
          storageKey: 'skill-detail-panel-width',
        }}
        hideClose
        title={skillDisplayName}
        className="flex flex-col gap-0 p-0"
      >
        <HStack
          justify="between"
          align="center"
          gap={2}
          className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
        >
          <Heading
            level={1}
            className="min-w-0 truncate text-base font-semibold"
          >
            {skillDisplayName}
          </Heading>
          <HStack gap={1} align="center" className="shrink-0">
            {skill ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Copy}
                  onClick={() => void handleDuplicate()}
                  isLoading={isDuplicating}
                  disabled={isDuplicating}
                >
                  {t('skills.actions.duplicate', { defaultValue: 'Duplicate' })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isDuplicating}
                >
                  {tCommon('actions.delete')}
                </Button>
              </>
            ) : null}
            <IconButton
              icon={X}
              aria-label={tCommon('aria.close')}
              variant="ghost"
              onClick={() => onOpenChange(false)}
            />
          </HStack>
        </HStack>

        {isLoading ? (
          <PanelLoadingSkeleton />
        ) : !skill ? (
          <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
            <Stack gap={4}>
              <Heading level={2}>
                {t('skills.notFound', { defaultValue: 'Skill not found' })}
              </Heading>
              {errorMessage ? (
                <Text variant="muted">{errorMessage}</Text>
              ) : null}
              <div>
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  {t('skills.backToList', { defaultValue: 'Back to skills' })}
                </Button>
              </div>
            </Stack>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
            <div className="hidden md:block">
              <SkillBundleTreePanel
                assets={filesData?.assets ?? skill.assets ?? []}
                slug={slug}
                selectedPath={selectedFile}
                onSelectPath={setSelectedFile}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto">
              {selectedFile !== 'SKILL.md' ? (
                <SkillAssetViewer
                  organizationId={organizationId}
                  skillSlug={slug}
                  assetPath={selectedFile}
                />
              ) : (
                <Stack gap={6} className="p-4">
                  <HStack
                    gap={4}
                    align="center"
                    className="border-border bg-muted/30 rounded-md border px-4 py-2"
                  >
                    <Stack gap={0}>
                      <Text variant="caption">
                        {t('skills.metadata.bundleFiles', {
                          defaultValue: 'Bundle files',
                        })}
                      </Text>
                      <Text variant="label">
                        {filesData?.assets?.length ?? skill.assets?.length ?? 0}
                      </Text>
                    </Stack>
                    {skill.meta.license ? (
                      <Stack gap={0}>
                        <Text variant="caption">
                          {t('skills.metadata.license', {
                            defaultValue: 'License',
                          })}
                        </Text>
                        <Text variant="label">{skill.meta.license}</Text>
                      </Stack>
                    ) : null}
                  </HStack>

                  <FormSection
                    label={t('skills.section.overview', {
                      defaultValue: 'Overview',
                    })}
                  >
                    <Stack gap={3}>
                      <Stack gap={1}>
                        <Text variant="caption">
                          {t('skills.form.slug', { defaultValue: 'Slug' })}
                        </Text>
                        <Text as="span" variant="code">
                          {skill.meta.name}
                        </Text>
                      </Stack>
                      <Stack gap={1}>
                        <Text variant="caption">
                          {t('skills.form.description', {
                            defaultValue: 'Description',
                          })}
                        </Text>
                        <Text variant="body" className="whitespace-pre-wrap">
                          {description || (
                            <Text as="span" variant="muted">
                              {t('skills.detail.descriptionEmpty', {
                                defaultValue: '(no description)',
                              })}
                            </Text>
                          )}
                        </Text>
                      </Stack>
                    </Stack>
                  </FormSection>

                  <FormSection
                    label={t('skills.section.body', {
                      defaultValue: 'Instructions (body)',
                    })}
                  >
                    <div
                      className={
                        markdownWrapperStyles +
                        ' border-border bg-background rounded-md border p-4'
                      }
                    >
                      {body.trim().length === 0 ? (
                        <Text variant="muted">
                          {t('skills.body.previewEmpty', {
                            defaultValue: '(Body is empty)',
                          })}
                        </Text>
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {body}
                        </ReactMarkdown>
                      )}
                    </div>
                  </FormSection>

                  <FormSection
                    label={t('skills.section.bundle', {
                      defaultValue: 'Bundle files',
                    })}
                  >
                    <SkillBundleAssetsList
                      assets={filesData?.assets ?? skill.assets ?? []}
                    />
                  </FormSection>

                  <FormSection
                    label={t('skills.section.auditHistory', {
                      defaultValue: 'Recent changes',
                    })}
                  >
                    <Stack gap={2}>
                      {!Array.isArray(auditRows) ? (
                        <Stack gap={2}>
                          {Array.from({ length: 3 }).map((_, idx) => (
                            <HStack
                              key={idx}
                              gap={3}
                              align="center"
                              className="border-border rounded-md border px-3 py-2"
                            >
                              <Skeleton className="h-5 w-16 rounded-md" />
                              <Stack gap={1} className="flex-1">
                                <Skeleton className="h-3 w-40" />
                                <Skeleton className="h-3 w-56" />
                              </Stack>
                            </HStack>
                          ))}
                        </Stack>
                      ) : auditRows.length === 0 ? (
                        <Text variant="muted">
                          {t('skills.auditHistory.empty', {
                            defaultValue:
                              'No audit entries yet for this skill.',
                          })}
                        </Text>
                      ) : (
                        <Stack gap={2}>
                          {auditRows.map((row) => (
                            <HStack
                              key={row._id}
                              gap={3}
                              align="center"
                              className="border-border rounded-md border px-3 py-2"
                            >
                              <Badge
                                variant={
                                  row.status === 'failure'
                                    ? 'destructive'
                                    : 'outline'
                                }
                              >
                                {t(`skills.auditHistory.action.${row.action}`, {
                                  defaultValue: row.action,
                                })}
                              </Badge>
                              <Stack gap={0} className="flex-1">
                                <Text
                                  variant="body"
                                  className="font-mono text-xs"
                                >
                                  {new Intl.DateTimeFormat(locale, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  }).format(new Date(row.timestamp))}
                                </Text>
                                <Text variant="muted" className="text-xs">
                                  {row.actorEmail ?? row.actorId}
                                  {row.actorRole ? ` · ${row.actorRole}` : ''}
                                  {row.status === 'failure' && row.errorMessage
                                    ? ` · ${row.errorMessage}`
                                    : ''}
                                </Text>
                              </Stack>
                            </HStack>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  </FormSection>
                </Stack>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <SkillDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        organizationId={organizationId}
        skillSlug={slug}
        expectedHash={hash}
        onDeleted={() => {
          setDeleteDialogOpen(false);
          onOpenChange(false);
          void queryClient.invalidateQueries({
            queryKey: ['config', 'skills'],
          });
        }}
      />
    </>
  );
}

function SkillBundleAssetsList({
  assets,
}: {
  assets: Array<{ path: string; size: number }>;
}) {
  const { t } = useT('settings');
  const { locale } = useLocale();
  if (assets.length === 0) {
    return (
      <Text variant="muted">
        {t('skills.bundle.empty', { defaultValue: 'No bundle files yet.' })}
      </Text>
    );
  }
  return (
    <Stack gap={1} className="border-border rounded-md border p-2">
      {assets.map((f) => (
        <HStack
          key={f.path}
          gap={2}
          align="center"
          justify="between"
          className="px-2 py-1.5"
        >
          <Text as="span" variant="body" className="font-mono text-sm">
            {f.path}
          </Text>
          <Text as="span" variant="caption">
            {formatBytes(f.size, locale)}
          </Text>
        </HStack>
      ))}
    </Stack>
  );
}

function PanelLoadingSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <aside className="border-border hidden w-72 shrink-0 overflow-y-auto border-r p-3 md:block">
        <Skeleton className="mb-2 ml-1 h-3 w-16" />
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5"
          >
            <Skeleton className="size-3.5 shrink-0 rounded" />
            <Skeleton
              className="h-3.5"
              style={{ width: `${55 + ((idx * 13) % 35)}%` }}
            />
          </div>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Stack gap={6} className="p-4">
          <Skeleton className="h-14 w-full rounded-md" />
          {Array.from({ length: 4 }).map((_, idx) => (
            <Stack key={idx} gap={3}>
              <Skeleton className="h-4 w-32" />
              <Skeleton
                className="w-full"
                style={{ height: idx === 1 ? '18rem' : '5rem' }}
              />
            </Stack>
          ))}
        </Stack>
      </div>
    </div>
  );
}
