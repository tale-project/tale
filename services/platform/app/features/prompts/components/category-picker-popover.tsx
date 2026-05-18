'use client';

import { Button } from '@tale/ui/button';
import {
  Check,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Popover } from '@/app/components/ui/overlays/popover';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import {
  canCreateCategoryInScope,
  canManageCategory,
} from '@/convex/prompts/category_access';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useCreatePromptCategory,
  useDeletePromptCategory,
  useRenamePromptCategory,
} from '../hooks/mutations';
import type { PromptCategory } from '../hooks/queries';
import { useCategories } from '../hooks/queries';
import { extractErrorCode } from '../lib/extract-error-code';

type PromptScope = 'global' | 'team' | 'personal';

export interface CategoryPickerPopoverProps {
  organizationId: string | undefined;
  /** Caller's id — used by `canManageCategory` for the personal-scope gate. */
  userId: string | undefined;
  isOrgAdmin: boolean;
  /** Current scope on the form. Determines which categories are pickable. */
  scope: PromptScope;
  /** For team-scope prompts, the currently selected team. */
  teamId: string | undefined;
  /** The caller's team memberships — used to filter visible team categories. */
  userTeamIds: readonly string[];
  /** Currently selected category id (or undefined for "None"). */
  selectedId: Id<'promptCategories'> | undefined;
  onSelect: (id: Id<'promptCategories'> | undefined) => void;
  /** Optional label rendered above the trigger for screen readers. */
  ariaLabelledBy?: string;
  disabled?: boolean;
}

/**
 * The form's category picker. Self-contained: owns the category list
 * fetch, the scope-aware filter, the "+ Add" affordance, and the inline
 * rename/delete row actions. Rename/delete are gated by
 * `canManageCategory` so non-admins only see the affordances on their
 * own personal categories.
 *
 * Selection model: single-value with an explicit "None" sentinel row.
 * Switching the form's `scope` or `teamId` re-filters the visible list;
 * the parent form is responsible for clearing `selectedId` when the
 * current selection is no longer visible (silent clear, per design).
 */
export function CategoryPickerPopover({
  organizationId,
  userId,
  isOrgAdmin,
  scope,
  teamId,
  userTeamIds,
  selectedId,
  onSelect,
  ariaLabelledBy,
  disabled,
}: CategoryPickerPopoverProps) {
  const { t } = useT('prompts');
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<Id<'promptCategories'> | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<PromptCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [createValue, setCreateValue] = useState('');
  const createInputRef = useRef<HTMLInputElement | null>(null);

  const userTeamSet = useMemo(() => new Set(userTeamIds), [userTeamIds]);

  const { data } = useCategories(organizationId);
  const createCategory = useCreatePromptCategory();
  const renameCategory = useRenamePromptCategory();
  const deleteCategory = useDeletePromptCategory();

  // Scope-aware filter: derived from the design contract for which
  // category scopes a prompt of `scope` can carry.
  const visible: PromptCategory[] = useMemo(() => {
    if (!data) return [];
    const personal = data.personal;
    const team = data.team.filter((c) =>
      c.teamId ? userTeamSet.has(c.teamId) : false,
    );
    const global = data.global;
    if (scope === 'global') return [...global];
    if (scope === 'team') {
      const teamScoped = teamId ? team.filter((c) => c.teamId === teamId) : [];
      return [...teamScoped, ...global];
    }
    // personal
    return [...personal, ...team, ...global];
  }, [data, scope, teamId, userTeamSet]);

  const selected = useMemo(
    () => (selectedId ? visible.find((c) => c._id === selectedId) : undefined),
    [selectedId, visible],
  );

  const triggerLabel = selected?.name ?? t('categories.pickerPlaceholder');

  // Reset transient UI state on close so the next open is clean.
  useEffect(() => {
    if (!open) {
      setRenamingId(null);
      setRenameValue('');
      setCreating(false);
      setCreateValue('');
    }
  }, [open]);

  // Autofocus the create input the moment it appears.
  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  const canCreate = canCreateCategoryInScope({ scope, isOrgAdmin });

  const handleSelect = useCallback(
    (id: Id<'promptCategories'> | undefined) => {
      onSelect(id);
      setOpen(false);
    },
    [onSelect],
  );

  const handleCreate = useCallback(async () => {
    if (!organizationId) return;
    const name = createValue.trim();
    if (!name) return;
    try {
      const row = await createCategory.mutateAsync({
        organizationId,
        scope,
        teamId: scope === 'team' ? teamId : undefined,
        name,
      });
      // Auto-select the new category so the form picks it up.
      onSelect(row._id);
      setCreating(false);
      setCreateValue('');
      setOpen(false);
    } catch (err) {
      const code = extractErrorCode(err);
      const key =
        code === 'duplicate_category'
          ? 'categories.duplicate'
          : code === 'forbidden'
            ? 'categories.createForbidden'
            : 'toast.saveFailed';
      if (key === 'toast.saveFailed') {
        console.error('[category-picker] create failed', err);
      }
      toast({ title: t(key), variant: 'destructive' });
    }
  }, [
    organizationId,
    createValue,
    createCategory,
    scope,
    teamId,
    onSelect,
    toast,
    t,
  ]);

  const handleRename = useCallback(
    async (category: PromptCategory) => {
      const name = renameValue.trim();
      if (!name || name === category.name) {
        setRenamingId(null);
        return;
      }
      try {
        await renameCategory.mutateAsync({
          categoryId: category._id,
          name,
        });
        setRenamingId(null);
        setRenameValue('');
      } catch (err) {
        const code = extractErrorCode(err);
        const key =
          code === 'duplicate_category'
            ? 'categories.duplicate'
            : code === 'forbidden'
              ? 'categories.cannotManage'
              : 'toast.saveFailed';
        if (key === 'toast.saveFailed') {
          console.error('[category-picker] rename failed', err);
        }
        toast({ title: t(key), variant: 'destructive' });
      }
    },
    [renameValue, renameCategory, toast, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await deleteCategory.mutateAsync({ categoryId: deleting._id });
      // If the deleted category was selected, clear it.
      if (selectedId === deleting._id) onSelect(undefined);
      toast({
        title: t('categories.deleteSuccess', { name: deleting.name }),
        variant: 'success',
      });
      setDeleting(null);
    } catch (err) {
      const code = extractErrorCode(err);
      const key =
        code === 'forbidden' ? 'categories.cannotManage' : 'toast.deleteFailed';
      if (key === 'toast.deleteFailed') {
        console.error('[category-picker] delete failed', err);
      }
      toast({ title: t(key), variant: 'destructive' });
    }
  }, [deleting, deleteCategory, selectedId, onSelect, toast, t]);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="start"
        contentClassName="p-0"
        modal
        trigger={
          <button
            type="button"
            aria-labelledby={ariaLabelledBy}
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              'border-input bg-background hover:bg-accent flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm',
              'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span
              className={cn('truncate', !selected && 'text-muted-foreground')}
            >
              {triggerLabel}
            </span>
            <ChevronDown
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
          </button>
        }
      >
        <div role="listbox" className="flex flex-col">
          {/*
           * No explicit "None" option. A prompt can still end up
           * uncategorized via category deletion or a scope change that
           * silently clears `categoryId`, but the picker doesn't offer
           * "uncategorized" as a deliberate choice.
           */}
          {visible.length === 0 ? (
            <p className="text-muted-foreground px-3 py-2 text-[12px]">
              {t('categories.empty')}
            </p>
          ) : (
            visible.map((c) => {
              const manageable = userId
                ? canManageCategory({
                    category: {
                      scope: c.scope,
                      teamId: c.teamId,
                      createdBy: c.createdBy,
                    },
                    userId,
                    isOrgAdmin,
                  })
                : false;
              const isRenaming = renamingId === c._id;
              return (
                <div
                  key={c._id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-1 py-0.5',
                    !isRenaming && 'hover:bg-accent',
                  )}
                >
                  {isRenaming ? (
                    <div className="flex flex-1 items-center gap-1 px-2 py-1">
                      <Input
                        size="sm"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleRename(c);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenamingId(null);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => void handleRename(c)}
                        className="text-muted-foreground hover:text-foreground p-1"
                        aria-label={t('categories.renameSave')}
                      >
                        <Check className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="text-muted-foreground hover:text-foreground p-1"
                        aria-label={t('categories.renameCancel')}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedId === c._id}
                        onClick={() => handleSelect(c._id)}
                        className="flex flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left text-[13px]"
                      >
                        <span className="truncate">{c.name}</span>
                        {selectedId === c._id && (
                          <Check
                            className="size-4 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                      {manageable && (
                        <CategoryRowActions
                          onRename={() => {
                            setRenamingId(c._id);
                            setRenameValue(c.name);
                          }}
                          onDelete={() => setDeleting(c)}
                          renameLabel={t('categories.rename')}
                          deleteLabel={t('categories.delete')}
                          moreLabel={t('categories.actions', { name: c.name })}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}

          {/* Create affordance. Visible only when the actor can create at the current scope. */}
          {canCreate && (
            <>
              <div className="border-border my-1 border-t" />
              {creating ? (
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <Input
                    ref={createInputRef}
                    size="sm"
                    value={createValue}
                    onChange={(e) => setCreateValue(e.target.value)}
                    placeholder={t('addCategory.inputPlaceholder')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCreate();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setCreating(false);
                        setCreateValue('');
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleCreate()}
                    disabled={!createValue.trim() || createCategory.isPending}
                  >
                    {t('categories.create')}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="text-muted-foreground hover:bg-accent flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px]"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t('addCategory.add')}
                </button>
              )}
            </>
          )}
        </div>
      </Popover>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={t('categories.deleteConfirmTitle')}
        description={
          deleting
            ? t('categories.deleteConfirmDescription', { name: deleting.name })
            : undefined
        }
        confirmText={t('categories.delete')}
        variant="destructive"
        onConfirm={() => void handleDelete()}
        isLoading={deleteCategory.isPending}
      />
    </>
  );
}

interface CategoryRowActionsProps {
  onRename: () => void;
  onDelete: () => void;
  renameLabel: string;
  deleteLabel: string;
  moreLabel: string;
}

/**
 * Small inline menu (rename / delete) attached to each manageable row.
 * Kept as a tiny popover so it doesn't compete with the main listbox's
 * keyboard semantics — selection on the row, management in the menu.
 */
function CategoryRowActions({
  onRename,
  onDelete,
  renameLabel,
  deleteLabel,
  moreLabel,
}: CategoryRowActionsProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      contentClassName="w-[140px] p-1"
      trigger={
        <button
          type="button"
          aria-label={moreLabel}
          className="text-muted-foreground hover:text-foreground rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      }
    >
      <button
        type="button"
        onClick={() => {
          onRename();
          setOpen(false);
        }}
        className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        {renameLabel}
      </button>
      <button
        type="button"
        onClick={() => {
          onDelete();
          setOpen(false);
        }}
        className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {deleteLabel}
      </button>
    </Popover>
  );
}
