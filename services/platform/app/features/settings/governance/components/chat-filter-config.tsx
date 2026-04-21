'use client';

import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

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
import type {
  ChatFilterCategory,
  ChatFilterConfig,
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
    const config = policy.config as ChatFilterConfig | undefined;
    if (config) {
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
        toast({ title: 'Content safety saved', variant: 'success' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Save failed';
        toast({ title: message, variant: 'destructive' });
      }
    },
    [upsertMutation, organizationId, toast],
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
    (index: number, enabled: boolean) => {
      const target = categories[index];
      if (!target) return;
      const next = categories.map((c, i) =>
        i === index ? { ...c, enabled } : c,
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
          `Delete category "${target.label}"? This removes its ${target.words.length} words and ${target.patterns.length} patterns.`,
        )
      ) {
        return;
      }
      const next = categories.filter((_, i) => i !== index);
      setCategories(next);
      setEditorIndex((prev) => (prev === index ? null : prev));
      void saveWith(buildConfig({ categories: next }));
    },
    [buildConfig, categories, saveWith],
  );

  if (isLoading) {
    return (
      <PageSection title="Content safety">
        <Skeleton className="h-32 w-full" />
      </PageSection>
    );
  }

  return (
    <PageSection
      title="Content safety"
      description="Word lists and custom regex applied to chat messages. All three modes (block / mask / flag) run in order and aggregate to a single audit event per message."
    >
      {cannotManage && (
        <Alert
          variant="warning"
          description="You need admin permissions to edit content safety policy."
        />
      )}

      <FormSection label="Enabled">
        <Switch
          id="chat-filter-enabled"
          checked={enabled}
          disabled={cannotManage}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            void saveWith(buildConfig({ enabled: checked }));
          }}
        />
      </FormSection>

      <FormSection
        label="Apply to"
        description="Input filters user messages before the model. Output filters the assistant's reply; may add per-chunk latency."
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
            <span>User input</span>
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
            <span>Model output</span>
          </label>
        </div>
      </FormSection>

      <FormSection label="Mask replacement">
        <Input
          id="chat-filter-mask"
          value={maskReplacement}
          disabled={cannotManage}
          onChange={(e) => setMaskReplacement(e.target.value)}
          onBlur={() => void saveWith(buildConfig({ maskReplacement }))}
        />
      </FormSection>

      <FormSection
        label="Prefer non-streaming when output filter is on"
        description="Wait for the complete response before showing anything. Eliminates any brief flash of unfiltered content in exchange for higher perceived latency."
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
        label="Categories"
        description="Each category has its own mode. block wins over mask wins over flag when multiple match."
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
    </PageSection>
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
  return (
    <div className="flex flex-col gap-2">
      {categories.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No categories configured. Add one to start filtering.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="py-1 font-medium">Label</th>
              <th className="py-1 font-medium">Mode</th>
              <th className="py-1 font-medium">Enabled</th>
              <th className="py-1 font-medium">Words</th>
              <th className="py-1 font-medium">Patterns</th>
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
                    aria-label={`Enable ${category.label}`}
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
                      aria-label={`Edit ${category.label}`}
                      disabled={disabled}
                      onClick={() => onEdit(index)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      aria-label={`Delete ${category.label}`}
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
          Add category
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
  const isNew = index === 'new';

  const [label, setLabel] = useState('New category');
  // New categories default to enabled=true. Admin wouldn't go to the
  // trouble of adding one only to leave it off — forcing the extra
  // toggle-click was a source of confusion.
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'block' | 'mask' | 'flag'>('flag');
  const [wordsText, setWordsText] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset on open + prop change. Guard on `open` so switching to a different
  // category while the sheet is closed doesn't churn state.
  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? 'New category');
    setEnabled(initial?.enabled ?? true);
    setMode(initial?.mode ?? 'flag');
    setWordsText(initial ? initial.words.join('\n') : '');
  }, [open, initial]);

  const canSave = label.trim().length > 0;

  const wordLines = wordsText
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);

  // Save only activates when the draft actually differs from the initial
  // state (or for a new category, once the required fields are filled).
  // Comparing `wordsText` against the joined baseline lets idle whitespace
  // edits that don't change meaningful words still count as "no change".
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
        `Replace ${wordLines.length} existing words with ${incoming.length} words from "${file.name}"?`,
      )
    ) {
      return;
    }

    setWordsText(incoming.join('\n'));
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={isNew ? 'Add category' : 'Edit category'}
      description="Configure a content safety category, its enforcement mode, and its word list."
      className="sm:!max-w-2xl"
    >
      <div className="flex h-full flex-col">
        <div className="shrink-0 pr-10">
          <h2 className="text-lg font-semibold tracking-tight">
            {isNew ? 'Add category' : 'Edit category'}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Block wins over mask wins over flag when multiple categories match
            the same message.
          </p>
        </div>

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-4">
            <FormSection label="Label">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Hate speech"
              />
            </FormSection>

            <FormSection label="Enabled">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </FormSection>

            <FormSection
              label="Mode"
              description="Block refuses the message. Mask replaces matches with the configured placeholder. Flag records the detection but lets the message pass."
            >
              <Select
                value={mode}
                onValueChange={(v) => {
                  if (v === 'block' || v === 'mask' || v === 'flag') setMode(v);
                }}
                options={[
                  { value: 'block', label: 'Block' },
                  { value: 'mask', label: 'Mask' },
                  { value: 'flag', label: 'Flag' },
                ]}
              />
            </FormSection>

            <FormSection
              label={`Words (${wordLines.length})`}
              description="One word or phrase per line. Case-insensitive. For CJK/Thai/Lao text, substring matching is used automatically; other scripts use Unicode-aware word boundaries."
            >
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Upload}
                    onClick={handleImportClick}
                  >
                    Import .txt
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Download}
                    disabled={wordLines.length === 0}
                    onClick={handleExport}
                  >
                    Export .txt
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
                  placeholder={`forbidden\nanother word\n傻逼`}
                />
              </div>
            </FormSection>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave || !hasChanges}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
