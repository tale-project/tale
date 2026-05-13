'use client';

import { Button } from '@tale/ui/button';
import { BookOpen, History, Plus, Search } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { HStack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Text } from '@/app/components/ui/typography/text';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useUpdatePrompt,
  useDeletePrompt,
  useIncrementPromptUsage,
} from '../hooks/mutations';
import type { PromptTemplate } from '../hooks/queries';
import { usePrompts } from '../hooks/queries';
import { extractErrorCode } from '../lib/extract-error-code';
import { CategoryFilterPopover } from './category-filter-popover';
import { PromptFormDialog, type PromptFormData } from './prompt-form-dialog';
import { PromptHistoryDialog } from './prompt-history-dialog';
import { PromptListRow } from './prompt-list-row';
import { SavePromptDialog } from './save-prompt-dialog';

export interface PromptLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPrompt: (content: string) => void;
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

  const { prompts, isLoading, canLoadMore, isLoadingMore, loadMore } =
    usePrompts(organizationId ?? '');

  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const incrementUsage = useIncrementPromptUsage();

  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
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

  const isAdmin =
    memberContext?.role === 'admin' || memberContext?.role === 'owner';

  const availableCategories = useMemo(() => {
    const cats = prompts.map((p) => p.category).filter((c): c is string => !!c);
    return [...new Set(cats)].sort((a, b) => a.localeCompare(b));
  }, [prompts]);

  const filteredPrompts = useMemo(() => {
    let filtered = prompts;

    if (activeTab === 'team') {
      filtered = filtered.filter((p) => p.scope === 'team');
    } else if (activeTab === 'personal') {
      filtered = filtered.filter((p) => p.scope === 'personal');
    }

    if (selectedCategories.length > 0) {
      filtered = filtered.filter(
        (p) => p.category && selectedCategories.includes(p.category),
      );
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query) ||
          p.content.toLowerCase().includes(query) ||
          p.category?.toLowerCase().includes(query) ||
          p.tags?.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    return filtered;
  }, [prompts, activeTab, searchQuery, selectedCategories]);

  const handleUsePrompt = useCallback(
    (prompt: PromptTemplate) => {
      onSelectPrompt(prompt.content);
      void incrementUsage.mutateAsync({
        promptId: prompt._id,
      });
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
        // Trust server's truth: bump-toast iff version actually advanced.
        // Comparing `data.content !== editingPrompt.content` could disagree
        // with the server's content-change detection (e.g. whitespace).
        if (
          result?.version !== undefined &&
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
        // Keep the dialog open on version_conflict so the user's draft and
        // the PromptFormDialog's "Load latest" affordance stay reachable.
        const toastKey =
          code === 'version_conflict'
            ? 'toast.versionConflict'
            : code === 'forbidden'
              ? 'toast.forbidden'
              : code === 'not_found'
                ? 'toast.notFound'
                : code === 'rate_limited'
                  ? 'toast.rateLimited'
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
            : 'toast.deleteFailed';
      if (toastKey === 'toast.deleteFailed') {
        console.error('[prompt-library] delete failed', err);
      }
      toast({ title: t(toastKey), variant: 'destructive' });
    }
  }, [deletingPrompt, deletePrompt, toast, t]);

  const tabItems = [
    { value: 'all', label: t('tabs.all') },
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
            onValueChange={setActiveTab}
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
          </HStack>

          <div className="max-h-[340px] min-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Text variant="muted">{t('library.loading')}</Text>
              </div>
            ) : filteredPrompts.length === 0 ? (
              <div className="flex h-[300px] flex-col items-center justify-center gap-4">
                <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                  <BookOpen className="text-muted-foreground size-6" />
                </div>
                <div className="flex flex-col items-center gap-2 text-center">
                  <Text as="h3" variant="label" className="font-medium">
                    {t('emptyState.title')}
                  </Text>
                  <Text variant="muted" className="max-w-[280px] text-sm">
                    {t('emptyState.description')}
                  </Text>
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                {filteredPrompts.map((prompt, index) => (
                  <PromptListRow
                    key={prompt._id}
                    prompt={prompt}
                    onUse={handleUsePrompt}
                    onEdit={
                      canModifyPrompt(prompt) && !prompt.sourceMessageId
                        ? (p) => setEditingPrompt(p)
                        : undefined
                    }
                    onDelete={
                      canModifyPrompt(prompt)
                        ? (p) => setDeletingPrompt(p)
                        : undefined
                    }
                    onViewHistory={
                      canModifyPrompt(prompt)
                        ? (p) => setHistoryPrompt(p)
                        : undefined
                    }
                    canModify={canModifyPrompt(prompt)}
                    isLast={index === filteredPrompts.length - 1}
                  />
                ))}
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

      <SavePromptDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialContent=""
      />

      <PromptFormDialog
        open={!!editingPrompt}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditingPrompt(null);
        }}
        onSubmit={handleEditSubmit}
        isSubmitting={updatePrompt.isPending}
        initialData={editingPrompt ?? undefined}
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
