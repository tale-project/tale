'use client';

import { Button } from '@tale/ui/button';
import { BookOpen, History, Plus, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { HStack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Text } from '@/app/components/ui/typography/text';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useCreatePrompt,
  useDeletePrompt,
  useIncrementPromptUsage,
  useUpdatePrompt,
} from '../hooks/mutations';
import type { PromptTemplate } from '../hooks/queries';
import { usePrompts } from '../hooks/queries';
import { extractErrorCode } from '../lib/extract-error-code';
import { CategoryFilterPopover } from './category-filter-popover';
import { PromptFormDialog, type PromptFormData } from './prompt-form-dialog';
import { PromptHistoryDialog } from './prompt-history-dialog';
import { PromptListRow } from './prompt-list-row';
import { TagFilterPopover } from './tag-filter-popover';

export interface PromptLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPrompt: (content: string) => void;
}

type TabValue = 'all' | 'global' | 'team' | 'personal';

const TAB_VALUES: readonly TabValue[] = ['all', 'global', 'team', 'personal'];

function isTabValue(value: string): value is TabValue {
  return (TAB_VALUES as readonly string[]).includes(value);
}

function PromptLibraryDialogContent({
  open,
  onOpenChange,
  onSelectPrompt,
}: PromptLibraryDialogProps) {
  const { t } = useT('prompts');
  const { toast } = useToast();
  const organizationId = useOrganizationId();
  const { data: currentUser } = useCurrentUser();
  const { data: memberContext } = useCurrentMemberContext(organizationId);

  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptTemplate | null>(
    null,
  );
  const [historyPrompt, setHistoryPrompt] = useState<PromptTemplate | null>(
    null,
  );
  const [deletingPrompt, setDeletingPrompt] = useState<PromptTemplate | null>(
    null,
  );

  const debouncedSearch = useDebounce(searchQuery.trim(), 200);
  const scopeArg: 'global' | 'team' | 'personal' | undefined =
    activeTab === 'all' ? undefined : activeTab;

  const { prompts, isLoading, canLoadMore, isLoadingMore, loadMore } =
    usePrompts(organizationId ?? '', {
      scope: scopeArg,
      searchPrefix: debouncedSearch || undefined,
    });

  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const incrementUsage = useIncrementPromptUsage();

  const isAdmin =
    memberContext?.role === 'admin' || memberContext?.role === 'owner';

  const availableCategories = useMemo(() => {
    const cats = prompts.map((p) => p.category).filter((c): c is string => !!c);
    return [...new Set(cats)].sort((a, b) => a.localeCompare(b));
  }, [prompts]);

  const availableTags = useMemo(() => {
    // Case-insensitive dedupe, preserve first-seen casing. Mirrors
    // tag-chip-input's commit-time dedupe so the facet list stays stable
    // across existing drifted data (e.g. legacy rows with `Foo` and `foo`).
    const seen = new Map<string, string>();
    for (const tag of prompts.flatMap((p) => p.tags ?? [])) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [prompts]);

  // Category + tag filtering is client-side: server pushes scope + search,
  // these remain derived facets of the loaded page. Acceptable since most
  // orgs have a small set of categories/tags and search already narrows.
  const visiblePrompts = useMemo(() => {
    const selectedTagsLower = selectedTags.map((tag) => tag.toLowerCase());
    return prompts.filter((p) => {
      if (
        selectedCategories.length > 0 &&
        (!p.category || !selectedCategories.includes(p.category))
      ) {
        return false;
      }
      if (
        selectedTagsLower.length > 0 &&
        !(p.tags ?? []).some((tag) =>
          selectedTagsLower.includes(tag.toLowerCase()),
        )
      ) {
        return false;
      }
      return true;
    });
  }, [prompts, selectedCategories, selectedTags]);

  const filtersActive =
    debouncedSearch.length > 0 ||
    selectedCategories.length > 0 ||
    selectedTags.length > 0;

  const handleUsePrompt = useCallback(
    (prompt: PromptTemplate) => {
      onSelectPrompt(prompt.content);
      // Fire-and-forget telemetry — log on failure rather than letting it
      // reject as an unhandled promise.
      incrementUsage
        .mutateAsync({ promptId: prompt._id })
        .catch((err) =>
          console.warn('[prompt-library] incrementUsage failed', err),
        );
      onOpenChange(false);
    },
    [onSelectPrompt, incrementUsage, onOpenChange],
  );

  const canModifyPrompt = useCallback(
    (prompt: PromptTemplate) => {
      if (!currentUser) return false;
      if (isAdmin) return true;
      return prompt.createdBy === currentUser.userId;
    },
    [currentUser, isAdmin],
  );

  const handleCreateSubmit = useCallback(
    async (data: PromptFormData) => {
      if (!organizationId) return;
      try {
        await createPrompt.mutateAsync({
          organizationId,
          title: data.title,
          content: data.content,
          description: data.description || undefined,
          scope: data.scope,
          teamId: data.teamId,
          category: data.category || undefined,
          tags: data.tags.length > 0 ? data.tags : undefined,
        });
        toast({ title: t('toast.created'), variant: 'success' });
        setFormOpen(false);
      } catch (err) {
        const code = extractErrorCode(err);
        const toastKey =
          code === 'forbidden'
            ? 'toast.forbidden'
            : code === 'rate_limited'
              ? 'toast.rateLimited'
              : code === 'too_large'
                ? 'toast.tooLarge'
                : code === 'empty_content'
                  ? 'toast.emptyContent'
                  : 'toast.saveFailed';
        if (toastKey === 'toast.saveFailed') {
          console.error('[prompt-library] create failed', err);
        }
        toast({ title: t(toastKey), variant: 'destructive' });
      }
    },
    [organizationId, createPrompt, toast, t],
  );

  const handleEditSubmit = useCallback(
    async (data: PromptFormData) => {
      if (!editingPrompt) return;
      try {
        const result = await updatePrompt.mutateAsync({
          promptId: editingPrompt._id,
          title: data.title,
          content: data.content,
          description: data.description || undefined,
          scope: data.scope,
          teamId: data.teamId,
          category: data.category || undefined,
          tags: data.tags.length > 0 ? data.tags : undefined,
          expectedVersion: data.expectedVersion,
        });
        // Server returns null when the row was deleted out from under us or
        // when the personal-scope owner gate rejected the caller. Treat as
        // not-found so the user's draft isn't silently dropped.
        if (result === null) {
          toast({ title: t('toast.notFound'), variant: 'destructive' });
          return;
        }
        if (
          result.version !== undefined &&
          result.version !== editingPrompt.version
        ) {
          toast({
            title: t('toast.saved', { version: String(result.version) }),
            variant: 'success',
          });
        }
        setEditingPrompt(null);
      } catch (err) {
        const code = extractErrorCode(err);
        const toastKey =
          code === 'version_conflict'
            ? 'toast.versionConflict'
            : code === 'forbidden'
              ? 'toast.forbidden'
              : code === 'not_found'
                ? 'toast.notFound'
                : code === 'rate_limited'
                  ? 'toast.rateLimited'
                  : code === 'too_large'
                    ? 'toast.tooLarge'
                    : code === 'empty_content'
                      ? 'toast.emptyContent'
                      : 'toast.saveFailed';
        if (toastKey === 'toast.saveFailed') {
          console.error('[prompt-library] update failed', err);
        }
        toast({ title: t(toastKey), variant: 'destructive' });
      }
    },
    [editingPrompt, updatePrompt, toast, t],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingPrompt) return;
    try {
      await deletePrompt.mutateAsync({
        promptId: deletingPrompt._id,
      });
      setDeletingPrompt(null);
    } catch (err) {
      const code = extractErrorCode(err);
      const toastKey =
        code === 'forbidden'
          ? 'toast.forbidden'
          : code === 'not_found'
            ? 'toast.notFound'
            : code === 'rate_limited'
              ? 'toast.rateLimited'
              : 'toast.deleteFailed';
      if (toastKey === 'toast.deleteFailed') {
        console.error('[prompt-library] delete failed', err);
      }
      toast({ title: t(toastKey), variant: 'destructive' });
    }
  }, [deletingPrompt, deletePrompt, toast, t]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCategories([]);
    setSelectedTags([]);
  }, []);

  const tabItems = [
    { value: 'all', label: t('tabs.all') },
    { value: 'global', label: t('tabs.global'), disabled: !isAdmin },
    { value: 'team', label: t('tabs.team') },
    { value: 'personal', label: t('tabs.personal') },
  ];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('library.title')}
        description={t('library.description')}
        className="w-[95vw] max-w-[680px]"
      >
        <div className="flex flex-col gap-4">
          <Tabs
            items={tabItems}
            value={activeTab}
            onValueChange={(v) => {
              if (isTabValue(v)) setActiveTab(v);
            }}
            actions={
              <Button
                onClick={() => setFormOpen(true)}
                className="h-9 shrink-0"
              >
                <Plus className="mr-1 size-4" />
                {t('actions.create')}
              </Button>
            }
          />

          <HStack gap={2} align="center">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('library.searchPlaceholder')}
                className="pl-9"
                aria-label={t('library.searchPlaceholder')}
              />
            </div>
            <CategoryFilterPopover
              categories={availableCategories}
              selectedCategories={selectedCategories}
              onSelectedCategoriesChange={setSelectedCategories}
            />
            <TagFilterPopover
              tags={availableTags}
              selectedTags={selectedTags}
              onSelectedTagsChange={setSelectedTags}
            />
          </HStack>

          <div
            className="max-h-[340px] min-h-[300px] overflow-y-auto"
            aria-busy={isLoading || undefined}
          >
            {isLoading && prompts.length === 0 ? (
              <div className="flex flex-col gap-2 py-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="bg-muted h-14 animate-pulse rounded-md"
                    aria-hidden="true"
                  />
                ))}
                <span className="sr-only">{t('library.loading')}</span>
              </div>
            ) : visiblePrompts.length === 0 ? (
              <div className="flex h-[300px] flex-col items-center justify-center gap-4">
                <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                  <BookOpen className="text-muted-foreground size-6" />
                </div>
                <div className="flex flex-col items-center gap-2 text-center">
                  <Text as="h3" variant="label" className="font-medium">
                    {filtersActive
                      ? t('emptyState.filteredTitle')
                      : t('emptyState.title')}
                  </Text>
                  <Text variant="muted" className="max-w-[280px] text-sm">
                    {filtersActive && canLoadMore
                      ? t('emptyState.filteredCanLoadMore')
                      : filtersActive
                        ? t('emptyState.filteredDescription')
                        : t('emptyState.description')}
                  </Text>
                  {filtersActive && (
                    <HStack gap={2} justify="center">
                      {canLoadMore && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={loadMore}
                          disabled={isLoadingMore}
                        >
                          {isLoadingMore
                            ? t('library.loadingMore')
                            : t('library.loadMore')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={clearFilters}
                      >
                        {t('emptyState.clearFilters')}
                      </Button>
                    </HStack>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col" role="list">
                {visiblePrompts.map((prompt, index) => {
                  const canModify = canModifyPrompt(prompt);
                  return (
                    <PromptListRow
                      key={prompt._id}
                      prompt={prompt}
                      onUse={handleUsePrompt}
                      onEdit={
                        canModify && !prompt.sourceMessageId
                          ? (p) => setEditingPrompt(p)
                          : undefined
                      }
                      onDelete={
                        canModify ? (p) => setDeletingPrompt(p) : undefined
                      }
                      onViewHistory={
                        canModify ? (p) => setHistoryPrompt(p) : undefined
                      }
                      canModify={canModify}
                      isLast={index === visiblePrompts.length - 1}
                    />
                  );
                })}
                {canLoadMore && (
                  <div className="flex justify-center py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadMore}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore
                        ? t('library.loadingMore')
                        : t('library.loadMore')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <PromptFormDialog
        open={formOpen || !!editingPrompt}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setFormOpen(false);
            setEditingPrompt(null);
          }
        }}
        onSubmit={editingPrompt ? handleEditSubmit : handleCreateSubmit}
        isSubmitting={
          editingPrompt ? updatePrompt.isPending : createPrompt.isPending
        }
        initialData={editingPrompt ?? undefined}
        isOrgAdmin={isAdmin}
        headerActions={
          editingPrompt && (editingPrompt.version ?? 0) > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setHistoryPrompt(editingPrompt)}
            >
              <History className="mr-1 size-3" />
              {t('actions.viewHistory')}
            </Button>
          ) : undefined
        }
      />

      {historyPrompt && (
        <PromptHistoryDialog
          open={!!historyPrompt}
          onOpenChange={(o) => {
            if (!o) setHistoryPrompt(null);
          }}
          prompt={historyPrompt}
        />
      )}

      <ConfirmDialog
        open={!!deletingPrompt}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeletingPrompt(null);
        }}
        title={t('deleteConfirm.title')}
        description={t('deleteConfirm.description', {
          title: deletingPrompt?.title ?? '',
        })}
        confirmText={t('actions.delete')}
        onConfirm={handleDeleteConfirm}
        variant="destructive"
        isLoading={deletePrompt.isPending}
      />
    </>
  );
}

export function PromptLibraryDialog(props: PromptLibraryDialogProps) {
  if (!props.open) return null;
  return <PromptLibraryDialogContent {...props} />;
}
