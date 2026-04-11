'use client';

import { Plus, Search } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { HStack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

import {
  useCreatePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  useIncrementPromptUsage,
} from '../hooks/mutations';
import type { PromptTemplate } from '../hooks/queries';
import { usePrompts } from '../hooks/queries';
import { PromptCard } from './prompt-card';
import { PromptFormDialog, type PromptFormData } from './prompt-form-dialog';

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
  const organizationId = useOrganizationId();
  const { data: currentUser } = useCurrentUser();
  const { data: memberContext } = useCurrentMemberContext(organizationId);

  const { prompts, isLoading } = usePrompts(organizationId ?? '');

  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const incrementUsage = useIncrementPromptUsage();

  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptTemplate | null>(
    null,
  );
  const [deletingPrompt, setDeletingPrompt] = useState<PromptTemplate | null>(
    null,
  );

  const isAdmin =
    memberContext?.role === 'admin' || memberContext?.role === 'owner';

  const filteredPrompts = useMemo(() => {
    let filtered = prompts;

    if (activeTab === 'team') {
      filtered = filtered.filter((p) => p.scope === 'team');
    } else if (activeTab === 'personal') {
      filtered = filtered.filter((p) => p.scope === 'personal');
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
  }, [prompts, activeTab, searchQuery]);

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

  const handleCreateSubmit = useCallback(
    async (data: PromptFormData) => {
      if (!organizationId) return;
      await createPrompt.mutateAsync({
        organizationId,
        title: data.title,
        content: data.content,
        description: data.description || undefined,
        scope: data.scope,
        category: data.category || undefined,
        tags: data.tags.length > 0 ? data.tags : undefined,
        isPublished: true,
      });
      setFormOpen(false);
    },
    [organizationId, createPrompt],
  );

  const handleEditSubmit = useCallback(
    async (data: PromptFormData) => {
      if (!editingPrompt) return;
      await updatePrompt.mutateAsync({
        promptId: editingPrompt._id,
        title: data.title,
        content: data.content,
        description: data.description || undefined,
        scope: data.scope,
        category: data.category || undefined,
        tags: data.tags.length > 0 ? data.tags : undefined,
      });
      setEditingPrompt(null);
    },
    [editingPrompt, updatePrompt],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingPrompt) return;
    await deletePrompt.mutateAsync({
      promptId: deletingPrompt._id,
    });
    setDeletingPrompt(null);
  }, [deletingPrompt, deletePrompt]);

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
        size="wide"
      >
        <div className="flex flex-col gap-4">
          <HStack justify="between" align="center">
            <Tabs
              items={tabItems}
              value={activeTab}
              onValueChange={setActiveTab}
            />
            <Button
              size="sm"
              onClick={() => setFormOpen(true)}
              className="shrink-0"
            >
              <Plus className="mr-1 size-4" />
              {t('actions.create')}
            </Button>
          </HStack>

          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('library.searchPlaceholder')}
              className="pl-9"
              aria-label={t('library.searchPlaceholder')}
            />
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Text variant="muted">{t('library.loading')}</Text>
              </div>
            ) : filteredPrompts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <Text variant="muted">{t('library.empty')}</Text>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFormOpen(true)}
                >
                  <Plus className="mr-1 size-4" />
                  {t('actions.createFirst')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredPrompts.map((prompt) => (
                  <PromptCard
                    key={prompt._id}
                    prompt={prompt}
                    onUse={handleUsePrompt}
                    onEdit={
                      canModifyPrompt(prompt)
                        ? (p) => setEditingPrompt(p)
                        : undefined
                    }
                    onDelete={
                      canModifyPrompt(prompt)
                        ? (p) => setDeletingPrompt(p)
                        : undefined
                    }
                    canModify={canModifyPrompt(prompt)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <PromptFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleCreateSubmit}
        isSubmitting={createPrompt.isPending}
      />

      <PromptFormDialog
        open={!!editingPrompt}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditingPrompt(null);
        }}
        onSubmit={handleEditSubmit}
        isSubmitting={updatePrompt.isPending}
        initialData={editingPrompt ?? undefined}
      />

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
