'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Card } from '@/app/components/ui/layout/card';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

const PROVIDER_OPTIONS_PLACEHOLDER = JSON.stringify(
  { provider: { quantizations: ['fp8'] } },
  null,
  2,
);

// Permissive client-side schema: server-side `providerJsonSchema.parse` is the
// authoritative gate (it carries the deny-list). This schema only catches
// "is JSON, is an object" so we don't ship obviously malformed input.
const providerOptionsClientSchema = z.record(z.string(), z.unknown());

/**
 * Convert a server-side `ConvexError({code:'INVALID_PROVIDER_CONFIG',
 * issues:[{path,message}]})` into a multi-line toast description so the user
 * can see WHICH field was rejected. Falls back to the raw error message for
 * non-ConvexError throws.
 */
function formatProviderOptionsError(err: unknown): string {
  if (err != null && typeof err === 'object' && 'data' in err) {
    const data = (err as { data: unknown }).data;
    if (
      data != null &&
      typeof data === 'object' &&
      'code' in data &&
      (data as { code: unknown }).code === 'INVALID_PROVIDER_CONFIG' &&
      'issues' in data &&
      Array.isArray((data as { issues: unknown }).issues)
    ) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `issues` was just structurally checked as `Array.isArray((data as { issues: unknown }).issues)` on the previous line; narrowing it to `unknown[]` to iterate doesn't add new claims
      const rawIssues = (data as { issues: unknown[] }).issues;
      const lines: string[] = [];
      for (const issue of rawIssues) {
        if (issue == null || typeof issue !== 'object') continue;
        const path = (issue as { path?: unknown }).path;
        const message = (issue as { message?: unknown }).message;
        lines.push(
          `${typeof path === 'string' ? path : ''}: ${typeof message === 'string' ? message : ''}`,
        );
      }
      return lines.join('\n');
    }
  }
  return err instanceof Error ? err.message : String(err);
}

interface Props {
  /** The current value as a JSON string (empty string = absent / no override). */
  initialJson: string;
  /** True when an outer save is in flight. */
  isSaving: boolean;
  /** Persist the parsed object via the parent's saveConfig flow. */
  onSave: (
    parsedOrUndefined: Record<string, unknown> | undefined,
  ) => Promise<void>;
  /** Translated copy. */
  copy: {
    title: string;
    description: string;
    notConfigured: string;
    editLabel: string;
    saveLabel: string;
    cancelLabel: string;
    saveSuccess: string;
    saveError: string;
  };
}

/**
 * Two-state editor for provider/model `providerOptions`:
 *
 * - **Card (read-only, default)**: shows the current JSON tree (or a "not
 *   configured" placeholder) plus an Edit pencil — matches the GeneralSection
 *   pattern so the field discovers itself in glance.
 * - **Sheet (edit)**: opened from the Edit button. Houses the full JsonInput
 *   (visual JSON + Source toggle + Zod validation) with Save/Cancel.
 *
 * Used at both the provider top level and per-model — the parent decides
 * which slice of the saved config the parsed object lands in.
 */
export function ProviderOptionsEditor({
  initialJson,
  isSaving,
  onSave,
  copy,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initialJson);
  const [submitting, setSubmitting] = useState(false);

  // Reset draft only on the open->true transition so a previous half-edit
  // doesn't come back to bite the user. Read `initialJson` via a ref so a
  // parent refresh during the edit doesn't clobber unsaved changes — the
  // effect only fires when `open` toggles, picking up the latest snapshot
  // at that moment.
  const initialJsonRef = useRef(initialJson);
  initialJsonRef.current = initialJson;
  useEffect(() => {
    if (open) setDraft(initialJsonRef.current);
  }, [open]);

  const handleSave = async () => {
    let parsed: Record<string, unknown> | undefined;
    const trimmed = draft.trim();
    if (trimmed === '') {
      parsed = undefined;
    } else {
      try {
        const obj: unknown = JSON.parse(trimmed);
        if (
          obj == null ||
          typeof obj !== 'object' ||
          Array.isArray(obj) ||
          Object.keys(obj).length === 0
        ) {
          parsed = undefined;
        } else {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime checks above narrow `obj` to a non-null, non-array plain object; TS can't track the narrowing across JSON.parse
          parsed = obj as Record<string, unknown>;
        }
      } catch (err) {
        toast({
          variant: 'destructive',
          title: copy.saveError,
          description: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSave(parsed);
      toast({ title: copy.saveSuccess });
      setOpen(false);
    } catch (err) {
      // When the server returns ConvexError({ code:'INVALID_PROVIDER_CONFIG',
      // issues:[...] }), surface each issue's path + message instead of the
      // raw stringified ZodError array.
      const description = formatProviderOptionsError(err);
      toast({
        variant: 'destructive',
        title: copy.saveError,
        description,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isEmpty = initialJson.trim() === '';

  return (
    <>
      <Card contentClassName="p-5">
        <HStack justify="between" align="start" className="border-b pb-4">
          <Stack gap={1} className="min-w-0">
            <Text className="text-sm font-semibold">{copy.title}</Text>
            <Text className="text-muted-foreground text-[13px] whitespace-pre-line">
              {copy.description}
            </Text>
          </Stack>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-[13px] font-medium"
          >
            <Pencil className="size-3.5" />
            {copy.editLabel}
          </button>
        </HStack>

        <div className="pt-4">
          {isEmpty ? (
            <Text className="text-muted-foreground text-[13px] italic">
              {copy.notConfigured}
            </Text>
          ) : (
            <pre className="bg-muted/40 overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed">
              {initialJson}
            </pre>
          )}
        </div>
      </Card>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={copy.title}
        size="md"
        hideClose
        className="flex flex-col gap-0 p-0"
      >
        <ProviderOptionsEditorSheet
          title={copy.title}
          description={copy.description}
          draft={draft}
          onDraftChange={setDraft}
          onClose={() => setOpen(false)}
          onSave={handleSave}
          submitting={submitting}
          isSaving={isSaving}
          unchanged={draft === initialJson}
          saveLabel={copy.saveLabel}
          cancelLabel={copy.cancelLabel}
        />
      </Sheet>
    </>
  );
}

interface SheetBodyProps {
  title: string;
  description: string;
  draft: string;
  onDraftChange: (next: string) => void;
  onClose: () => void;
  onSave: () => void;
  submitting: boolean;
  isSaving: boolean;
  unchanged: boolean;
  saveLabel: string;
  cancelLabel: string;
}

function ProviderOptionsEditorSheet({
  title,
  description,
  draft,
  onDraftChange,
  onClose,
  onSave,
  submitting,
  isSaving,
  unchanged,
  saveLabel,
  cancelLabel,
}: SheetBodyProps) {
  const { t: tCommon } = useT('common');
  return (
    <>
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {title}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={onClose}
        />
      </HStack>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
          <Stack gap={3}>
            <Text className="text-muted-foreground text-[13px] whitespace-pre-line">
              {description}
            </Text>
            <JsonInput
              value={draft}
              onChange={onDraftChange}
              schema={providerOptionsClientSchema}
              rows={10}
              fontSize={12}
            />
            <Text className="text-muted-foreground text-[12px]">
              {`Example: ${PROVIDER_OPTIONS_PLACEHOLDER.replace(/\s+/g, ' ')}`}
            </Text>
          </Stack>
        </div>

        <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
          <HStack justify="end" align="center" gap={2}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={submitting}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={submitting || isSaving || unchanged}
            >
              {saveLabel}
            </Button>
          </HStack>
        </div>
      </div>
    </>
  );
}

/** Small helper: serialize a Record back to a pretty JSON string for the editor. */
export function providerOptionsToJsonString(
  value: Record<string, unknown> | undefined,
): string {
  if (!value || Object.keys(value).length === 0) return '';
  return JSON.stringify(value, null, 2);
}

/**
 * Inline JSON editor for the model add/edit Sheet. The parent already
 * provides modal framing — opening another Sheet on top would be redundant,
 * so this just renders the JsonInput directly under the description.
 */
interface ModelEditorProps {
  /** Current value as JSON string. Empty string = absent. */
  value: string;
  /** Setter wired into the dialog's form state. */
  onChange: (next: string) => void;
  /** Translated copy. `helpText` renders below the editor. */
  copy: {
    title: string;
    description: string;
    helpText: string;
  };
}

export function ModelProviderOptionsField({
  value,
  onChange,
  copy,
}: ModelEditorProps) {
  return (
    <Stack gap={2} className="border-border border-t pt-4">
      <Text className="text-sm font-semibold">{copy.title}</Text>
      <Text className="text-muted-foreground text-[13px] whitespace-pre-line">
        {copy.description}
      </Text>
      <JsonInput
        value={value}
        onChange={onChange}
        schema={providerOptionsClientSchema}
        rows={6}
        fontSize={12}
      />
      <Text className="text-muted-foreground text-[12px] whitespace-pre-line">
        {copy.helpText}
      </Text>
    </Stack>
  );
}
