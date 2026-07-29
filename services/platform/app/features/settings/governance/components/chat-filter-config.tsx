'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  chatFilterConfigSchema,
  type ChatFilterCategory,
  type ChatFilterConfig,
} from '@/lib/shared/schemas/governance';

import { mapGovernanceSaveError } from '../governance-save-errors';
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

interface ChatFilterDraft {
  enabled: boolean;
  maskReplacement: string;
  appliesToInput: boolean;
  appliesToOutput: boolean;
  preferNonStreaming: boolean;
  categories: ChatFilterCategory[];
}

const DEFAULT_DRAFT: ChatFilterDraft = {
  enabled: false,
  maskReplacement: '[BLOCKED]',
  appliesToInput: true,
  appliesToOutput: false,
  preferNonStreaming: false,
  categories: [],
};

type ChatFilterPolicy = ReturnType<typeof useGovernancePolicy>['data'];

/**
 * Derive the editor draft from the persisted policy. Returns the defaults
 * (so the masked-during-load view still has a valid shape to render) when
 * there's no policy yet or the stored config fails schema validation.
 */
function deriveDraft(policy: ChatFilterPolicy): ChatFilterDraft {
  if (!policy) return DEFAULT_DRAFT;
  const parsed = chatFilterConfigSchema.safeParse(policy.config);
  if (!parsed.success) return DEFAULT_DRAFT;
  const config = parsed.data;
  return {
    enabled: policy.enabled ?? config.enabled ?? false,
    maskReplacement: config.maskReplacement ?? '[BLOCKED]',
    appliesToInput: config.appliesTo?.includes('input') ?? true,
    appliesToOutput: config.appliesTo?.includes('output') ?? false,
    preferNonStreaming: config.preferNonStreamingForFiltering ?? false,
    categories: config.categories ?? [],
  };
}

// =============================================================================
// Container — owns data fetching, local edit state, save/toast wiring, and the
// loading state. Wraps the plain `ChatFilterConfigForm` in `<Skeletonize>` so
// the same tree renders the skeleton (the hand-rolled loading `SettingsSection`
// with magic-height `Skeleton` boxes is gone — the skeleton-aware `<Switch>` /
// `<Input>` mask themselves to their real height).
//
// `enabled` and the rest of the draft are seeded LAZILY from the (possibly
// already-warm) policy so the first render shows real values — replacing the
// post-mount `useEffect`/`initializedRef` swap that flashed defaults for a
// frame on warm navigations. A one-time render-time sync still adopts a cold
// read once it lands (pre-commit → no flicker); after that, edits are
// client-owned and the optimistic upsert keeps the server read in step.
//
// NOTE: exported as `ChatFilterConfigView` because the guardrails route already
// imports that name as the entry point — keep it stable.
// =============================================================================
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

  const initial = useMemo(() => deriveDraft(policy), [policy]);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [maskReplacement, setMaskReplacement] = useState(
    initial.maskReplacement,
  );
  const [appliesToInput, setAppliesToInput] = useState(initial.appliesToInput);
  const [appliesToOutput, setAppliesToOutput] = useState(
    initial.appliesToOutput,
  );
  const [preferNonStreaming, setPreferNonStreaming] = useState(
    initial.preferNonStreaming,
  );
  const [categories, setCategories] = useState(initial.categories);

  const [editorIndex, setEditorIndex] = useState<number | 'new' | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  const cannotManage = ability.cannot('write', 'orgSettings');

  // One-time sync for the cold-load case: the lazy seeds above ran against an
  // absent policy, so adopt the real config the first render it lands. Runs
  // pre-commit, so no default→real flash; afterwards edits stay client-owned.
  const syncedRef = useRef(policy != null);
  if (!syncedRef.current && policy != null) {
    syncedRef.current = true;
    setEnabled(initial.enabled);
    setMaskReplacement(initial.maskReplacement);
    setAppliesToInput(initial.appliesToInput);
    setAppliesToOutput(initial.appliesToOutput);
    setPreferNonStreaming(initial.preferNonStreaming);
    setCategories(initial.categories);
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
        toast({
          title: mapGovernanceSaveError(
            error,
            t,
            t('contentSafety.saveFailed'),
          ),
          variant: 'destructive',
        });
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

  const confirmDeleteCategory = useCallback(() => {
    if (deletingIndex === null) return;
    const index = deletingIndex;
    const next = categories.filter((_, i) => i !== index);
    setCategories(next);
    setEditorIndex((prev) => {
      if (prev === null || prev === 'new') return prev;
      if (prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
    setDeletingIndex(null);
    void saveWith(buildConfig({ categories: next }));
  }, [buildConfig, categories, deletingIndex, saveWith]);

  const handleEnabledChange = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      void saveWith(buildConfig({ enabled: checked }));
    },
    [buildConfig, saveWith],
  );

  const handleAppliesToInput = useCallback(
    (checked: boolean) => {
      setAppliesToInput(checked);
      void saveWith(buildConfig({ appliesToInput: checked }));
    },
    [buildConfig, saveWith],
  );

  const handleAppliesToOutput = useCallback(
    (checked: boolean) => {
      setAppliesToOutput(checked);
      void saveWith(buildConfig({ appliesToOutput: checked }));
    },
    [buildConfig, saveWith],
  );

  const handlePreferNonStreaming = useCallback(
    (checked: boolean) => {
      setPreferNonStreaming(checked);
      void saveWith(buildConfig({ preferNonStreaming: checked }));
    },
    [buildConfig, saveWith],
  );

  return (
    <Skeletonize loading={isLoading} label={t('contentSafety.title')}>
      <SettingsSection
        id="guardrails-content-safety"
        title={t('contentSafety.title')}
        description={t('contentSafety.description')}
        action={
          <Switch
            id="chat-filter-enabled"
            aria-label={t('contentSafety.enableLabel')}
            checked={enabled}
            disabled={cannotManage}
            onCheckedChange={handleEnabledChange}
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
            {/* One divided list for the section's settings — label + hint
                left, control right, like every other section. Marked so the
                shared divider rule draws its hairline between this block and
                the Categories block below it. */}
            <SettingsFieldList data-settings-section="">
              <SettingsFieldRow
                label={t('contentSafety.applyTo')}
                description={t('contentSafety.applyToDescription')}
              >
                <Stack gap={2}>
                  <Checkbox
                    label={t('contentSafety.userInput')}
                    checked={appliesToInput}
                    disabled={cannotManage}
                    onCheckedChange={(v) => handleAppliesToInput(Boolean(v))}
                  />
                  <Checkbox
                    label={t('contentSafety.modelOutput')}
                    checked={appliesToOutput}
                    disabled={cannotManage}
                    onCheckedChange={(v) => handleAppliesToOutput(Boolean(v))}
                  />
                </Stack>
              </SettingsFieldRow>

              <SettingsFieldRow label={t('contentSafety.maskReplacement')}>
                <Input
                  id="chat-filter-mask"
                  aria-label={t('contentSafety.maskReplacement')}
                  value={maskReplacement}
                  disabled={cannotManage}
                  onChange={(e) => setMaskReplacement(e.target.value)}
                  onBlur={() => void saveWith(buildConfig({ maskReplacement }))}
                  wrapperClassName="w-full"
                />
              </SettingsFieldRow>

              {/* A toggle row is already a settings row — it joins the list
                  so it shares the same divider and vertical rhythm. */}
              <SettingsToggleRow
                className="py-5"
                label={t('contentSafety.preferNonStreaming')}
                description={t('contentSafety.preferNonStreamingDescription')}
                checked={preferNonStreaming}
                disabled={cannotManage}
                onCheckedChange={handlePreferNonStreaming}
              />
            </SettingsFieldList>

            <FormSection
              label={t('contentSafety.categoriesTitle')}
              description={t('contentSafety.categoriesDescription')}
              data-settings-section=""
            >
              <CategoryList
                categories={categories}
                disabled={cannotManage}
                onAdd={() => setEditorIndex('new')}
                onEdit={(index) => setEditorIndex(index)}
                onDelete={(index) => setDeletingIndex(index)}
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

            <ConfirmDialog
              open={deletingIndex !== null}
              onOpenChange={(open) => {
                if (!open) setDeletingIndex(null);
              }}
              title={t('contentSafety.deleteConfirmTitle')}
              description={
                deletingIndex !== null && categories[deletingIndex]
                  ? t('contentSafety.deleteConfirm', {
                      label: categories[deletingIndex].label,
                      words: categories[deletingIndex].words.length,
                      patterns: categories[deletingIndex].patterns.length,
                    })
                  : ''
              }
              confirmText={t('contentSafety.deleteConfirmAction')}
              variant="destructive"
              onConfirm={confirmDeleteCategory}
            />
          </>
        )}
      </SettingsSection>
    </Skeletonize>
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
    <Stack gap={0} className="h-full">
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
        <Stack>
          <FormSection label={t('contentSafety.categoryLabel')}>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('contentSafety.categoryLabelPlaceholder')}
            />
          </FormSection>

          <Switch
            aria-label={t('contentSafety.enabled')}
            checked={enabled}
            onCheckedChange={setEnabled}
          />

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
            <Stack gap={2}>
              <Row gap={2} align="stretch">
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
              </Row>
              <Textarea
                value={wordsText}
                rows={14}
                className="font-mono text-base md:text-xs"
                onChange={(e) => setWordsText(e.target.value)}
                placeholder={t('contentSafety.wordsPlaceholder')}
              />
            </Stack>
          </FormSection>
        </Stack>
      </div>

      <Row
        gap={2}
        align="stretch"
        justify="end"
        className="shrink-0 border-t pt-4"
      >
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
      </Row>
    </Stack>
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
  return (
    <Stack gap={2}>
      {categories.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          {t('contentSafety.categoriesEmpty')}
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('contentSafety.columnLabel')}</TableHead>
                <TableHead>{t('contentSafety.columnMode')}</TableHead>
                <TableHead>{t('contentSafety.columnEnabled')}</TableHead>
                <TableHead>{t('contentSafety.columnWords')}</TableHead>
                <TableHead>{t('contentSafety.columnPatterns')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category, index) => (
                <TableRow key={category.id}>
                  <TableCell>{category.label}</TableCell>
                  <TableCell className="capitalize">{category.mode}</TableCell>
                  <TableCell>
                    <Switch
                      checked={category.enabled}
                      disabled={disabled}
                      aria-label={t('contentSafety.enableAria', {
                        label: category.label,
                      })}
                      onCheckedChange={(next) => onToggleEnabled(index, next)}
                    />
                  </TableCell>
                  <TableCell>{category.words.length}</TableCell>
                  <TableCell>{category.patterns.length}</TableCell>
                  <TableCell>
                    <Row gap={1} align="stretch" justify="end">
                      <IconButton
                        variant="ghost"
                        size="sm"
                        icon={Pencil}
                        aria-label={t('contentSafety.editAria', {
                          label: category.label,
                        })}
                        disabled={disabled}
                        onClick={() => onEdit(index)}
                      />
                      <IconButton
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        aria-label={t('contentSafety.deleteAria', {
                          label: category.label,
                        })}
                        disabled={disabled}
                        onClick={() => onDelete(index)}
                      />
                    </Row>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div>
        <Button
          variant="secondary"
          icon={Plus}
          disabled={disabled}
          onClick={onAdd}
        >
          {t('contentSafety.addCategory')}
        </Button>
      </div>
    </Stack>
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
