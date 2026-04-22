'use client';

import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Alert } from '@/app/components/ui/feedback/alert';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  chatFilterConfigSchema,
  type ChatFilterCategory,
  type ChatFilterConfig,
} from '@/lib/shared/schemas/governance';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface ChatFilterConfigProps {
  organizationId: string;
}

function randomCategoryId(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `custom_${suffix}`;
}

function sanitizeFilename(raw: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '_');
  return base.length > 0 ? base : 'category';
}

export function ChatFilterConfigView({
  organizationId,
}: ChatFilterConfigProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'chat_filter',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const [enabled, setEnabled] = useState(false);
  const [maskReplacement, setMaskReplacement] = useState('[BLOCKED]');
  const [appliesToInput, setAppliesToInput] = useState(true);
  const [appliesToOutput, setAppliesToOutput] = useState(false);
  const [preferNonStreaming, setPreferNonStreaming] = useState(false);
  const [categories, setCategories] = useState<ChatFilterCategory[]>([]);

  const [editorIndex, setEditorIndex] = useState<number | 'new' | null>(null);

  const cannotManage = ability.cannot('write', 'orgSettings');
  const initializedRef = useRef(false);

  if (!isLoading && !initializedRef.current && policy) {
    initializedRef.current = true;
    const parsed = chatFilterConfigSchema.safeParse(policy.config);
    if (parsed.success) {
      const config = parsed.data;
      setEnabled(policy.enabled ?? config.enabled ?? false);
      setMaskReplacement(config.maskReplacement ?? '[BLOCKED]');
      setAppliesToInput(config.appliesTo?.includes('input') ?? true);
      setAppliesToOutput(config.appliesTo?.includes('output') ?? false);
      setPreferNonStreaming(config.preferNonStreamingForFiltering ?? false);
      setCategories(config.categories ?? []);
    }
  }

  const buildConfig = useCallback(
    (overrides: {
      enabled?: boolean;
      maskReplacement?: string;
      appliesToInput?: boolean;
      appliesToOutput?: boolean;
      preferNonStreaming?: boolean;
      categories?: ChatFilterCategory[];
    }): ChatFilterConfig => {
      const nextInput = overrides.appliesToInput ?? appliesToInput;
      const nextOutput = overrides.appliesToOutput ?? appliesToOutput;
      const appliesTo: Array<'input' | 'output'> = [];
      if (nextInput) appliesTo.push('input');
      if (nextOutput) appliesTo.push('output');
      if (appliesTo.length === 0) appliesTo.push('input');

      return {
        enabled: overrides.enabled ?? enabled,
        maskReplacement: overrides.maskReplacement ?? maskReplacement,
        appliesTo,
        preferNonStreamingForFiltering:
          overrides.preferNonStreaming ?? preferNonStreaming,
        configVersion: 1,
        categories: overrides.categories ?? categories,
      };
    },
    [
      enabled,
      maskReplacement,
      appliesToInput,
      appliesToOutput,
      preferNonStreaming,
      categories,
    ],
  );

  const saveWith = useCallback(
    async (config: ChatFilterConfig) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'chat_filter',
          config,
        });
        toast({ title: t('contentSafety.saved'), variant: 'success' });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('contentSafety.saveFailed');
        toast({ title: message, variant: 'destructive' });
      }
    },
    [upsertMutation, organizationId, toast, t],
  );

  const handleSaveCategory = useCallback(
    (index: number | 'new', draft: ChatFilterCategory) => {
      const next =
        index === 'new'
          ? [...categories, draft]
          : categories.map((c, i) => (i === index ? draft : c));
      setCategories(next);
      setEditorIndex(null);
      void saveWith(buildConfig({ categories: next }));
    },
    [buildConfig, categories, saveWith],
  );

  const handleToggleCategoryEnabled = useCallback(
    (index: number, nextEnabled: boolean) => {
      const target = categories[index];
      if (!target) return;
      const next = categories.map((c, i) =>
        i === index ? { ...c, enabled: nextEnabled } : c,
      );
      setCategories(next);
      void saveWith(buildConfig({ categories: next }));
    },
    [buildConfig, categories, saveWith],
  );

  const handleDeleteCategory = useCallback(
    (index: number) => {
      const target = categories[index];
      if (!target) return;
      if (
        typeof window !== 'undefined' &&
        !window.confirm(
          t('contentSafety.deleteConfirm', {
            label: target.label,
            words: target.words.length,
            patterns: target.patterns.length,
          }),
        )
      ) {
        return;
      }
      const next = categories.filter((_, i) => i !== index);
      setCategories(next);
      setEditorIndex((prev) => (prev === index ? null : prev));
      void saveWith(buildConfig({ categories: next }));
    },
    [buildConfig, categories, saveWith, t],
  );

  if (isLoading) {
    return (
      <PageSection title={t('contentSafety.title')}>
        <Skeleton className="h-32 w-full" />
      </PageSection>
    );
  }

  return (
    <PageSection
      title={t('contentSafety.title')}
      description={t('contentSafety.description')}
      action={
        <Switch
          id="chat-filter-enabled"
          label={t('contentSafety.enableLabel')}
          checked={enabled}
          disabled={cannotManage}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            void saveWith(buildConfig({ enabled: checked }));
          }}
        />
      }
    >
      {cannotManage && (
        <Alert
          variant="warning"
          description={t('contentSafety.cannotManage')}
        />
      )}

      {enabled && (
        <>
          <FormSection
            label={t('contentSafety.applyTo')}
            description={t('contentSafety.applyToDescription')}
          >
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={appliesToInput}
                  disabled={cannotManage}
                  onChange={(e) => {
                    setAppliesToInput(e.target.checked);
                    void saveWith(
                      buildConfig({ appliesToInput: e.target.checked }),
                    );
                  }}
                />
                <span>{t('contentSafety.userInput')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={appliesToOutput}
                  disabled={cannotManage}
                  onChange={(e) => {
                    setAppliesToOutput(e.target.checked);
                    void saveWith(
                      buildConfig({ appliesToOutput: e.target.checked }),
                    );
                  }}
                />
                <span>{t('contentSafety.modelOutput')}</span>
              </label>
            </div>
          </FormSection>

          <FormSection label={t('contentSafety.maskReplacement')}>
            <Input
              id="chat-filter-mask"
              value={maskReplacement}
              disabled={cannotManage}
              onChange={(e) => setMaskReplacement(e.target.value)}
              onBlur={() => void saveWith(buildConfig({ maskReplacement }))}
            />
          </FormSection>

          <FormSection
            label={t('contentSafety.preferNonStreaming')}
            description={t('contentSafety.preferNonStreamingDescription')}
          >
            <Switch
              id="chat-filter-nonstreaming"
              checked={preferNonStreaming}
              disabled={cannotManage}
              onCheckedChange={(checked) => {
                setPreferNonStreaming(checked);
                void saveWith(buildConfig({ preferNonStreaming: checked }));
              }}
            />
          </FormSection>

          <FormSection
            label={t('contentSafety.categoriesTitle')}
            description={t('contentSafety.categoriesDescription')}
          >
            <CategoryList
              categories={categories}
              disabled={cannotManage}
              onAdd={() => setEditorIndex('new')}
              onEdit={(index) => setEditorIndex(index)}
              onDelete={handleDeleteCategory}
              onToggleEnabled={handleToggleCategoryEnabled}
            />
          </FormSection>

          <CategoryEditSheet
            open={editorIndex !== null}
            index={editorIndex}
            initial={
              editorIndex === null || editorIndex === 'new'
                ? undefined
                : categories[editorIndex]
            }
            onCancel={() => setEditorIndex(null)}
            onSave={(draft) => {
              if (editorIndex === null) return;
              handleSaveCategory(editorIndex, draft);
            }}
          />
        </>
      )}
    </PageSection>
  );
}

// ---------------------------------------------------------------------------
// Category edit form (inner, unmounts on sheet close)
// ---------------------------------------------------------------------------

interface CategoryEditFormProps {
  isNew: boolean;
  initial?: ChatFilterCategory;
  onCancel: () => void;
  onSave: (draft: ChatFilterCategory) => void;
}

function CategoryEditForm({
  isNew,
  initial,
  onCancel,
  onSave,
}: CategoryEditFormProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  // Initialized from `initial` on mount. Because this component unmounts on
  // sheet close (key on the parent), a reopen re-mounts with a fresh
  // snapshot of `initial` — so an earlier abandoned draft can never leak
  // into a later edit session, and the previous useEffect-based reset
  // (which was the source of a mode-revert bug) is no longer needed.
  const [label, setLabel] = useState(
    initial?.label ?? t('contentSafety.newCategoryDefault'),
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [mode, setMode] = useState<'block' | 'mask' | 'flag'>(
    initial?.mode ?? 'flag',
  );
  const [wordsText, setWordsText] = useState(
    initial ? initial.words.join('\n') : '',
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSave = label.trim().length > 0;

  const wordLines = wordsText
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);

  const initialLabel = initial?.label ?? '';
  const initialEnabled = initial?.enabled ?? true;
  const initialMode = initial?.mode ?? 'flag';
  const initialWordsJoined = initial ? initial.words.join('\n') : '';
  const hasChanges =
    isNew ||
    label.trim() !== initialLabel ||
    enabled !== initialEnabled ||
    mode !== initialMode ||
    wordLines.join('\n') !== initialWordsJoined;

  const handleSave = () => {
    onSave({
      id: initial?.id ?? randomCategoryId(),
      label: label.trim(),
      enabled,
      mode,
      words: wordLines,
      patterns: initial?.patterns ?? [],
    });
  };

  const handleExport = () => {
    const text = wordLines.join('\n') + (wordLines.length > 0 ? '\n' : '');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(label)}-words.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const text = await file.text();
    const incoming = text
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    if (incoming.length === 0) {
      return;
    }

    const hadExisting = wordLines.length > 0;
    if (
      hadExisting &&
      typeof window !== 'undefined' &&
      !window.confirm(
        t('contentSafety.importReplaceConfirm', {
          existing: wordLines.length,
          incoming: incoming.length,
          filename: file.name,
        }),
      )
    ) {
      return;
    }

    setWordsText(incoming.join('\n'));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 pr-10">
        <h2 className="text-lg font-semibold tracking-tight">
          {isNew
            ? t('contentSafety.addCategory')
            : t('contentSafety.editCategory')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('contentSafety.categoryEditorDescription')}
        </p>
      </div>

      <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-4">
          <FormSection label={t('contentSafety.categoryLabel')}>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('contentSafety.categoryLabelPlaceholder')}
            />
          </FormSection>

          <FormSection label={t('contentSafety.enabled')}>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </FormSection>

          <FormSection
            label={t('contentSafety.categoryMode')}
            description={t('contentSafety.categoryModeDescription')}
          >
            <Select
              value={mode}
              onValueChange={(v) => {
                if (v === 'block' || v === 'mask' || v === 'flag') setMode(v);
              }}
              options={[
                { value: 'block', label: t('contentSafety.modeBlock') },
                { value: 'mask', label: t('contentSafety.modeMask') },
                { value: 'flag', label: t('contentSafety.modeFlag') },
              ]}
            />
          </FormSection>

          <FormSection
            label={t('contentSafety.wordsCount', { count: wordLines.length })}
            description={t('contentSafety.wordsDescription')}
          >
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Upload}
                  onClick={handleImportClick}
                >
                  {t('contentSafety.importTxt')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  disabled={wordLines.length === 0}
                  onClick={handleExport}
                >
                  {t('contentSafety.exportTxt')}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  onChange={(e) => {
                    void handleImportFile(e);
                  }}
                />
              </div>
              <Textarea
                value={wordsText}
                rows={14}
                className="font-mono text-xs"
                onChange={(e) => setWordsText(e.target.value)}
                placeholder={t('contentSafety.wordsPlaceholder')}
              />
            </div>
          </FormSection>
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onCancel}>
          {tCommon('actions.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!canSave || !hasChanges}
          onClick={handleSave}
        >
          {tCommon('actions.save')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category list
// ---------------------------------------------------------------------------

interface CategoryListProps {
  categories: readonly ChatFilterCategory[];
  disabled: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggleEnabled: (index: number, enabled: boolean) => void;
}

function CategoryList({
  categories,
  disabled,
  onAdd,
  onEdit,
  onDelete,
  onToggleEnabled,
}: CategoryListProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  return (
    <div className="flex flex-col gap-2">
      {categories.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          {t('contentSafety.categoriesEmpty')}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="py-1 font-medium">
                {t('contentSafety.columnLabel')}
              </th>
              <th className="py-1 font-medium">
                {t('contentSafety.columnMode')}
              </th>
              <th className="py-1 font-medium">
                {t('contentSafety.columnEnabled')}
              </th>
              <th className="py-1 font-medium">
                {t('contentSafety.columnWords')}
              </th>
              <th className="py-1 font-medium">
                {t('contentSafety.columnPatterns')}
              </th>
              <th className="py-1 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category, index) => (
              <tr key={category.id} className="border-border border-t">
                <td className="py-2">{category.label}</td>
                <td className="py-2 capitalize">{category.mode}</td>
                <td className="py-2">
                  <Switch
                    checked={category.enabled}
                    disabled={disabled}
                    aria-label={t('contentSafety.enableAria', {
                      label: category.label,
                    })}
                    onCheckedChange={(next) => onToggleEnabled(index, next)}
                  />
                </td>
                <td className="py-2">{category.words.length}</td>
                <td className="py-2">{category.patterns.length}</td>
                <td className="py-2">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Pencil}
                      aria-label={t('contentSafety.editAria', {
                        label: category.label,
                      })}
                      disabled={disabled}
                      onClick={() => onEdit(index)}
                    >
                      {tCommon('actions.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      aria-label={t('contentSafety.deleteAria', {
                        label: category.label,
                      })}
                      disabled={disabled}
                      onClick={() => onDelete(index)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          disabled={disabled}
          onClick={onAdd}
        >
          {t('contentSafety.addCategory')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category edit sheet (side panel)
// ---------------------------------------------------------------------------

interface CategoryEditSheetProps {
  open: boolean;
  index: number | 'new' | null;
  initial?: ChatFilterCategory;
  onCancel: () => void;
  onSave: (draft: ChatFilterCategory) => void;
}

function CategoryEditSheet({
  open,
  index,
  initial,
  onCancel,
  onSave,
}: CategoryEditSheetProps) {
  const { t } = useT('governance');
  const isNew = index === 'new';

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={
        isNew ? t('contentSafety.addCategory') : t('contentSafety.editCategory')
      }
      description={t('contentSafety.categorySheetDescription')}
      className="sm:!max-w-2xl"
    >
      {/* Keyed so each open re-mounts the form with fresh state derived from
          `initial`. Previously the form was a single useState/useEffect
          instance that survived open→close cycles, and the effect's reset
          could race with the Save button's closure — the symptom was a
          saved "Mask" change silently reverting to the prior "Flag" value. */}
      {open && index !== null && (
        <CategoryEditForm
          key={isNew ? 'new' : (initial?.id ?? `index-${index}`)}
          isNew={isNew}
          initial={initial}
          onCancel={onCancel}
          onSave={onSave}
        />
      )}
    </Sheet>
  );
}
