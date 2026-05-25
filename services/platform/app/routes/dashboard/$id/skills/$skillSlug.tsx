import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  useBlocker,
  useNavigate,
} from '@tanstack/react-router';
import { ArrowLeft, Code, Copy, FileText, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { markdownWrapperStyles } from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { SkillAssetEditorDialog } from '@/app/features/skills/components/skill-asset-editor-dialog';
import { SkillAssetsSection } from '@/app/features/skills/components/skill-assets-section';
import { SkillBundleTreePanel } from '@/app/features/skills/components/skill-bundle-tree-panel';
import { SkillDeleteDialog } from '@/app/features/skills/components/skill-delete-dialog';
import { SkillDetailSidebar } from '@/app/features/skills/components/skill-detail-sidebar';
import {
  useDuplicateSkill,
  useUpdateSkill,
} from '@/app/features/skills/hooks/mutations';
import {
  useFindAgentsBindingSkill,
  useGetSkillAuditHistory,
  useListSkillFiles,
  useReadSkill,
} from '@/app/features/skills/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';
import { isRecord } from '@/lib/utils/type-guards';

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

  // Server-side description + body, tracked in lockstep with `hash` so
  // we can distinguish "loaded clean" from "user edited" without diffing
  // every keystroke against the (potentially refetched) source.
  const [loadedDescription, setLoadedDescription] = useState('');
  const [loadedBody, setLoadedBody] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [hash, setHash] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  // Body view: 'edit' (raw markdown textarea) | 'preview' (rendered).
  // Matches the upstream Claude skills UX where the SKILL.md body is
  // visible as rendered markdown by default and editable on toggle.
  const [bodyView, setBodyView] = useState<'edit' | 'preview'>('edit');

  // Surface which agents are bound to this skill so the operator
  // doesn't have to open the delete dialog to find out — previously
  // this was the only path to that information.
  const { data: relatedAgents } = useFindAgentsBindingSkill(
    organizationId,
    skillSlug,
  );
  const { data: auditRows } = useGetSkillAuditHistory(
    organizationId,
    skillSlug,
  );
  const { mutateAsync: duplicateSkill } = useDuplicateSkill();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  // Tree-pane file selection. `null` (or `'SKILL.md'`) shows the
  // existing right-pane content (metadata, edit form, audit log, …);
  // any other value opens the asset editor dialog scoped to that
  // file. Closing the dialog snaps the selection back to SKILL.md so
  // the user lands on the root view, mirroring the Claude shape where
  // closing a file returns focus to the bundle root.
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const assetEditorOpen = selectedFile !== 'SKILL.md';
  const handleAssetDialogChange = useCallback(
    (open: boolean) => {
      if (!open) setSelectedFile('SKILL.md');
    },
    [setSelectedFile],
  );

  const skill = data?.ok ? data : null;
  const isDirty = description !== loadedDescription || body !== loadedBody;

  // Group assets by top-level directory so the bundle list reads as a
  // shallow tree (scripts/, references/, assets/, ...) instead of a flat
  // sorted dump. The actual editor surface stays per-file — this is
  // purely a presentation-layer grouping.
  const groupedAssets = useMemo(() => {
    const assets = filesData?.assets ?? skill?.assets ?? [];
    const groups = new Map<string, Array<{ path: string; size: number }>>();
    for (const asset of assets) {
      const slash = asset.path.indexOf('/');
      const bucket = slash === -1 ? '.' : asset.path.slice(0, slash);
      const arr = groups.get(bucket) ?? [];
      arr.push(asset);
      groups.set(bucket, arr);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, files]) => ({
        dir,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      }));
  }, [filesData, skill]);

  const handleDuplicate = useCallback(async () => {
    if (!skill || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const { newSlug } = await duplicateSkill({
        organizationId,
        slug: skillSlug,
      });
      toast({
        title: t('skills.skillDuplicated', {
          defaultValue: 'Skill duplicated as {slug}',
          slug: newSlug,
        }),
        variant: 'success',
      });
      void navigate({
        to: '/dashboard/$id/skills/$skillSlug',
        params: { id: organizationId, skillSlug: newSlug },
      });
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
    skillSlug,
    navigate,
    t,
  ]);

  // Sync local form state with the loaded skill ONLY on first load or after
  // an explicit reload — never while the user has dirty edits, otherwise
  // a background refetch would clobber active typing. The hash-change check
  // remains so post-save (where we know local === server) we pick up the
  // new hash.
  useEffect(() => {
    if (!skill) return;
    if (skill.hash === hash) return;
    if (isDirty) return; // never overwrite the user's in-flight edits
    setDescription(skill.meta.description);
    setBody(skill.body);
    setLoadedDescription(skill.meta.description);
    setLoadedBody(skill.body);
    setHash(skill.hash);
  }, [skill, hash, isDirty]);

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty && !isSaving,
    enableBeforeUnload: () => isDirty && !isSaving,
    withResolver: true,
  });

  const handleDiscard = useCallback(() => {
    if (!skill) return;
    setDescription(loadedDescription);
    setBody(loadedBody);
  }, [skill, loadedDescription, loadedBody]);

  const handleSave = useCallback(async () => {
    if (!skill || isSaving || !isDirty) return;
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
      setLoadedDescription(description);
      setLoadedBody(body);
      toast({
        title: t('skills.skillSaved', { defaultValue: 'Skill saved' }),
        variant: 'success',
      });
      void queryClient.invalidateQueries({
        queryKey: ['config', 'skills', organizationId, skillSlug],
      });
    } catch (error) {
      // Shape-based ConvexError narrowing — `instanceof ConvexError`
      // is unreliable across HMR / route code-split boundaries (the
      // project docs explicitly warn against it), so we read the
      // structured `data.code` directly via `isRecord`.
      let errData: Record<string, unknown> | undefined;
      if (error && typeof error === 'object' && 'data' in error) {
        const rawData = (error as { data?: unknown }).data;
        if (isRecord(rawData)) errData = rawData;
      }
      const code = typeof errData?.code === 'string' ? errData.code : undefined;
      const message =
        typeof errData?.message === 'string' ? errData.message : undefined;
      if (code === 'CONFLICT') {
        toast({
          title: t('skills.conflict', {
            defaultValue:
              'This skill was edited elsewhere. Reload to see the latest version.',
          }),
          variant: 'destructive',
        });
        // Force the hydration effect to re-pull from server on the next
        // tick by clearing the local hash; the `if (skill.hash === hash)`
        // guard now lets the refetched content through. Without this the
        // dirty-state guard kept the stale `expectedHash` forever and
        // every retry tripped CONFLICT — an infinite loop the user could
        // only escape by discarding. User edits are still preserved
        // (the secondary dirty guard at the top of the hydration effect
        // still applies once the new hash lands).
        setHash(undefined);
        void refetch();
        return;
      }
      if (code === 'INVALID_FRONTMATTER' || code === 'TOO_LARGE') {
        toast({
          title:
            message ??
            t('skills.validationError', {
              defaultValue: 'Invalid skill configuration',
            }),
          variant: 'destructive',
        });
        return;
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
    isDirty,
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
      <ContentArea>
        <Skeleton className="h-24 w-full" />
      </ContentArea>
    );
  }

  if (!skill) {
    const errorMessage = data && !data.ok ? data.message : undefined;
    return (
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
    );
  }

  const transitiveDeps =
    (skill.meta.toolNames?.length ?? 0) +
    (skill.meta.integrationBindings?.length ?? 0) +
    (skill.meta.workflowBindings?.length ?? 0);

  return (
    <>
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
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            icon={Copy}
            onClick={() => void handleDuplicate()}
            isLoading={isDuplicating}
            disabled={isSaving || isDuplicating}
          >
            {t('skills.actions.duplicate', { defaultValue: 'Duplicate' })}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            onClick={() => setDeleteDialogOpen(true)}
            disabled={isSaving || isDuplicating}
          >
            {tCommon('actions.delete')}
          </Button>
        </HStack>
      </AdaptiveHeaderRoot>
      {/* Three-pane shell mirroring the Claude skills UX:
          - Left: every skill in the org (jump between skills without
            bouncing back to the list route)
          - Middle: file tree of THIS skill's bundle (click → opens the
            asset editor dialog)
          - Right: the existing edit form (metadata, body, deps,
            where-bound, audit history)

          The shell stacks vertically on mobile because the per-pane
          minimum widths (~17rem each) would otherwise force horizontal
          scroll on narrow viewports. Hiding the rails entirely keeps
          the detail content readable; users can navigate via the
          back-to-list button. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="hidden md:block">
          <SkillDetailSidebar
            organizationId={organizationId}
            currentSlug={skillSlug}
          />
        </div>
        <div className="hidden md:block">
          <SkillBundleTreePanel
            assets={filesData?.assets ?? skill.assets ?? []}
            totalBytes={filesData?.totalBytes ?? skill.totalBytes ?? 0}
            maxTotalBytes={filesData?.maxTotalBytes ?? 1024 * 1024}
            maxAssets={filesData?.maxAssets ?? 32}
            selectedPath={selectedFile}
            onSelectPath={setSelectedFile}
          />
        </div>
        <ContentArea className="min-w-0 flex-1">
          <Stack gap={6} className="p-4">
            {/* Metadata strip — anchors what type of resource this is and
              who can invoke it. Mirrors the Claude skills UX so admins
              get the same "at-a-glance" answer without scrolling. */}
            <HStack
              gap={4}
              align="center"
              className="border-border bg-muted/30 rounded-md border px-4 py-2"
            >
              <Stack gap={0}>
                <Text variant="caption">
                  {t('skills.metadata.trigger', { defaultValue: 'Trigger' })}
                </Text>
                <Text variant="label">
                  {t('skills.metadata.triggerAuto', {
                    defaultValue: 'Auto (model-invoked)',
                  })}
                </Text>
              </Stack>
              <Stack gap={0}>
                <Text variant="caption">
                  {t('skills.metadata.transitive', {
                    defaultValue: 'Transitive deps',
                  })}
                </Text>
                <Text variant="label">{transitiveDeps}</Text>
              </Stack>
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
                    {t('skills.metadata.license', { defaultValue: 'License' })}
                  </Text>
                  <Text variant="label">{skill.meta.license}</Text>
                </Stack>
              ) : null}
            </HStack>
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
                <HStack gap={1} justify="end">
                  <Button
                    size="sm"
                    variant={bodyView === 'edit' ? 'secondary' : 'ghost'}
                    icon={Code}
                    onClick={() => setBodyView('edit')}
                    aria-pressed={bodyView === 'edit'}
                  >
                    {t('skills.body.viewEdit', { defaultValue: 'Edit' })}
                  </Button>
                  <Button
                    size="sm"
                    variant={bodyView === 'preview' ? 'secondary' : 'ghost'}
                    icon={FileText}
                    onClick={() => setBodyView('preview')}
                    aria-pressed={bodyView === 'preview'}
                  >
                    {t('skills.body.viewPreview', { defaultValue: 'Preview' })}
                  </Button>
                </HStack>
                {bodyView === 'edit' ? (
                  <Textarea
                    id="body"
                    label={t('skills.form.body', {
                      defaultValue: 'Body markdown',
                    })}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={18}
                    className="font-mono text-sm"
                  />
                ) : (
                  // Sanitized markdown preview — reuses the chat-message
                  // wrapper styles so prose, code blocks, lists, and links
                  // look identical to how the LLM sees expanded skill
                  // content. ReactMarkdown's default rehype config strips
                  // raw HTML, so XSS via SKILL.md body is closed off.
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {body}
                      </ReactMarkdown>
                    )}
                  </div>
                )}
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
              <Stack gap={4}>
                {groupedAssets.length > 0 ? (
                  // Shallow tree: header per top-level directory, then
                  // file names underneath. Single-level grouping is the
                  // sweet spot — skills almost never nest beyond
                  // scripts/, references/, assets/ in practice, and a
                  // recursive tree would just be ceremony.
                  <Stack gap={3}>
                    {groupedAssets.map(({ dir, files }) => (
                      <Stack key={dir} gap={1}>
                        <Text variant="caption" className="font-mono">
                          {dir === '.'
                            ? t('skills.bundle.dirRoot', {
                                defaultValue: '(root)',
                              })
                            : `${dir}/`}
                        </Text>
                        <Stack gap={0} className="ml-3">
                          {files.map((f) => {
                            const leaf =
                              dir === '.'
                                ? f.path
                                : f.path.slice(dir.length + 1);
                            return (
                              <Text
                                key={f.path}
                                variant="muted"
                                className="font-mono text-xs"
                              >
                                {leaf}
                              </Text>
                            );
                          })}
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                ) : null}
                <SkillAssetsSection
                  organizationId={organizationId}
                  skillSlug={skillSlug}
                  assets={filesData?.assets ?? skill.assets ?? []}
                  totalBytes={filesData?.totalBytes ?? skill.totalBytes ?? 0}
                  maxTotalBytes={filesData?.maxTotalBytes ?? 1024 * 1024}
                  maxAssets={filesData?.maxAssets ?? 32}
                />
              </Stack>
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

            <FormSection
              label={t('skills.section.whereBound', {
                defaultValue: 'Where this skill is bound',
              })}
            >
              <Stack gap={2}>
                {!Array.isArray(relatedAgents) ? (
                  <Skeleton className="h-12 w-full" />
                ) : relatedAgents.length === 0 ? (
                  <Text variant="muted">
                    {t('skills.whereBound.empty', {
                      defaultValue:
                        'No agents currently bind this skill. Bindings show up here once a developer adds the skill to an agent.',
                    })}
                  </Text>
                ) : (
                  <Stack gap={1}>
                    {relatedAgents.map((a) => (
                      <HStack key={a.agentName} gap={2} align="center">
                        <Badge variant="outline">{a.agentName}</Badge>
                        {a.displayName && a.displayName !== a.agentName ? (
                          <Text variant="muted">{a.displayName}</Text>
                        ) : null}
                      </HStack>
                    ))}
                  </Stack>
                )}
              </Stack>
            </FormSection>

            <FormSection
              label={t('skills.section.auditHistory', {
                defaultValue: 'Recent changes',
              })}
            >
              <Stack gap={2}>
                {!Array.isArray(auditRows) ? (
                  <Skeleton className="h-12 w-full" />
                ) : auditRows.length === 0 ? (
                  <Text variant="muted">
                    {t('skills.auditHistory.empty', {
                      defaultValue: 'No audit entries yet for this skill.',
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
                            row.status === 'failure' ? 'destructive' : 'outline'
                          }
                        >
                          {row.action}
                        </Badge>
                        <Stack gap={0} className="flex-1">
                          <Text variant="body" className="font-mono text-xs">
                            {new Date(row.timestamp).toLocaleString()}
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

            <HStack gap={2} justify="end">
              <Button
                variant="ghost"
                onClick={handleDiscard}
                disabled={!isDirty || isSaving}
              >
                {tCommon('actions.discard')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                isLoading={isSaving}
                disabled={!isDirty || isSaving}
              >
                {tCommon('actions.save')}
              </Button>
            </HStack>
          </Stack>
        </ContentArea>
      </div>
      <SkillAssetEditorDialog
        open={assetEditorOpen}
        onOpenChange={handleAssetDialogChange}
        organizationId={organizationId}
        skillSlug={skillSlug}
        assetPath={assetEditorOpen ? selectedFile : null}
      />
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title={t('skills.unsavedChanges.title', {
          defaultValue: 'Discard unsaved changes?',
        })}
        description={t('skills.unsavedChanges.description', {
          defaultValue:
            'You have unsaved edits on this skill. Leaving now will discard them.',
        })}
        confirmText={t('skills.unsavedChanges.leave', {
          defaultValue: 'Discard and leave',
        })}
        cancelText={t('skills.unsavedChanges.stay', {
          defaultValue: 'Keep editing',
        })}
        variant="destructive"
        onConfirm={() => blocker.proceed?.()}
      />
      <SkillDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        organizationId={organizationId}
        skillSlug={skillSlug}
        expectedHash={hash}
        onDeleted={() =>
          void navigate({
            to: '/dashboard/$id/skills',
            params: { id: organizationId },
          })
        }
      />
    </>
  );
}
