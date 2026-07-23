'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { CollapsibleGuide } from '@/app/components/ui/data-display/collapsible-guide';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { isRecord } from '@/lib/utils/type-utils';

// Permissive client-side schema: server-side `providerJsonSchema.parse` is the
// authoritative gate (it carries the deny-list). This schema only catches
// "is JSON, is an object" so we don't ship obviously malformed input.
const providerOptionsClientSchema = z.record(z.string(), z.unknown());

// Client-side shape check for the request-body map. It flags the common mistake
// (putting `max_tokens` at the top level instead of under `rename`) inline in
// the JSON editor with a message that states the correct structure, instead of
// letting it through to a server-side rejection. Built as a record + refine so
// we control the wording (and stay version-agnostic). The server
// `providerJsonSchema.parse` stays authoritative (it also rejects
// prototype-pollution keys).
const REQUEST_BODY_MAP_SHAPE_HINT =
  'Only "rename" and "remove" are allowed. To rename a field, nest it under "rename" — e.g. { "rename": { "max_tokens": "max_completion_tokens" } }. To drop a field, list it under "remove" — e.g. { "remove": ["frequency_penalty"] }.';

const requestBodyMapClientSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (key !== 'rename' && key !== 'remove') {
        ctx.addIssue({ code: 'custom', message: REQUEST_BODY_MAP_SHAPE_HINT });
      }
    }
    const rename = value.rename;
    if (
      rename !== undefined &&
      (typeof rename !== 'object' || rename === null || Array.isArray(rename))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '"rename" must be an object of { "oldName": "newName" }.',
        path: ['rename'],
      });
    }
    if (value.remove !== undefined && !Array.isArray(value.remove)) {
      ctx.addIssue({
        code: 'custom',
        message: '"remove" must be an array of field names to drop.',
        path: ['remove'],
      });
    }
  });

const REQUEST_BODY_MAP_PLACEHOLDER = JSON.stringify(
  { rename: { max_tokens: 'max_completion_tokens' } },
  null,
  2,
);
import { Card } from '@tale/ui/card';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { Sheet } from '@/app/components/ui/overlays/sheet';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

const PROVIDER_OPTIONS_PLACEHOLDER = JSON.stringify(
  { provider: { quantizations: ['fp8'] } },
  null,
  2,
);

interface DraftValidation {
  ok: boolean;
  error?: string;
}

function validateDraft(
  draft: string,
  objectRequiredError: string,
): DraftValidation {
  const trimmed = draft.trim();
  if (trimmed === '') return { ok: true };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      return { ok: false, error: objectRequiredError };
    }
    return { ok: true };
  } catch (err) {
    // JSON.parse error message stays in English (it's the JS engine's text);
    // we keep it because it includes the position hint, which a translated
    // generic message would lose. Inline-only.
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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
    guideLabel: string;
    notConfigured: string;
    editLabel: string;
    saveLabel: string;
    cancelLabel: string;
    saveSuccess: string;
    saveError: string;
    exampleLabel: string;
    discardConfirmTitle: string;
    discardConfirmDescription: string;
    discardConfirmAction: string;
    discardConfirmKeep: string;
    /** Inline validation: shown when JSON parses to a non-object (array/primitive). */
    objectRequiredError: string;
  };
}

/**
 * Two-state editor for provider/model `providerOptions`:
 *
 * - **Card (read-only, default)**: shows the current JSON tree (or a "not
 *   configured" placeholder) plus an Edit pencil — matches the GeneralSection
 *   pattern so the field discovers itself in glance.
 * - **Sheet (edit)**: opened from the Edit button. Plain monospace
 *   textarea so a single Save button (the Sheet's) owns commit; the
 *   visual-mode JSON viewer is intentionally not rendered here because
 *   its add/edit/delete affordances are not keyboard reachable.
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
  const [discardOpen, setDiscardOpen] = useState(false);

  // Reset draft and capture the dirty-check baseline only on the
  // open->true transition. A parent refresh while the sheet is open
  // (sibling save / SSE invalidation / refetch) must NOT overwrite the
  // baseline, otherwise `isDirty` flips against a value the user never
  // saw and discard-confirm gates fire wrong. The ref is intentionally
  // written only inside the `open` branch.
  const initialJsonRef = useRef(initialJson);
  useEffect(() => {
    if (open) {
      initialJsonRef.current = initialJson;
      setDraft(initialJson);
    }
  }, [open, initialJson]);

  const isDirty = draft !== initialJsonRef.current;
  const validation = validateDraft(draft, copy.objectRequiredError);

  // Close paths (X, Cancel, Esc, overlay) all funnel through here. Silently
  // closing on a dirty draft is the prior footgun; gate behind a discard
  // confirm to surface the loss.
  const requestClose = () => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    setOpen(false);
  };
  const confirmDiscard = () => {
    setDiscardOpen(false);
    setOpen(false);
  };

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
      <Stack gap={3}>
        <HStack justify="between" align="center" wrap className="gap-y-1">
          <Text
            as="h3"
            className="text-foreground min-w-0 text-base leading-tight font-semibold"
          >
            {copy.title}
          </Text>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => setOpen(true)}
          >
            <Pencil className="mr-1 size-3.5" />
            {copy.editLabel}
          </Button>
        </HStack>

        <CollapsibleGuide label={copy.guideLabel} content={copy.description} />

        <Card padding="none" className="px-4 py-2.5">
          {isEmpty ? (
            <Text className="text-muted-foreground text-sm italic">
              {copy.notConfigured}
            </Text>
          ) : (
            // role+aria-label announces the read-only block as a labeled
            // region. Keyboard scrolling of the `overflow-x-auto` content
            // is left to the platform's built-in scroll affordance — we
            // can't add tabIndex to a non-interactive <pre> per a11y
            // lint rules, and elevating it to interactive would break
            // expectations for screen reader / button users.
            <pre
              role="region"
              aria-label={copy.title}
              className="bg-muted/40 overflow-x-auto rounded-md font-mono text-xs leading-relaxed"
            >
              {initialJson}
            </pre>
          )}
        </Card>
      </Stack>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            requestClose();
            return;
          }
          setOpen(true);
        }}
        title={copy.title}
        size="md"
        hideClose
        className="flex flex-col gap-0 p-0"
      >
        <ProviderOptionsEditorSheet
          title={copy.title}
          description={copy.description}
          guideLabel={copy.guideLabel}
          draft={draft}
          onDraftChange={setDraft}
          onClose={requestClose}
          onSave={handleSave}
          submitting={submitting}
          isSaving={isSaving}
          isDirty={isDirty}
          validation={validation}
          saveLabel={copy.saveLabel}
          cancelLabel={copy.cancelLabel}
          exampleLabel={copy.exampleLabel}
        />
      </Sheet>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={copy.discardConfirmTitle}
        description={copy.discardConfirmDescription}
        confirmText={copy.discardConfirmAction}
        cancelText={copy.discardConfirmKeep}
        variant="destructive"
        onConfirm={confirmDiscard}
      />
    </>
  );
}

interface SheetBodyProps {
  title: string;
  description: string;
  guideLabel: string;
  draft: string;
  onDraftChange: (next: string) => void;
  onClose: () => void;
  onSave: () => void;
  submitting: boolean;
  isSaving: boolean;
  isDirty: boolean;
  validation: DraftValidation;
  saveLabel: string;
  cancelLabel: string;
  exampleLabel: string;
}

function ProviderOptionsEditorSheet({
  title,
  description,
  guideLabel,
  draft,
  onDraftChange,
  onClose,
  onSave,
  submitting,
  isSaving,
  isDirty,
  validation,
  saveLabel,
  cancelLabel,
  exampleLabel,
}: SheetBodyProps) {
  const { t: tCommon } = useT('common');
  const inFlight = submitting || isSaving;
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
          disabled={inFlight}
        />
      </HStack>

      <Stack gap={0} className="min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
          <Stack gap={3}>
            <CollapsibleGuide label={guideLabel} content={description} />
            <Textarea
              // `aria-label` (instead of a visible `label`) so screen
              // readers announce the textarea's purpose without
              // duplicating the Sheet's visible heading at line 359.
              aria-label={title}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              rows={12}
              spellCheck={false}
              disabled={inFlight}
              placeholder={PROVIDER_OPTIONS_PLACEHOLDER}
              errorMessage={validation.ok ? undefined : validation.error}
              className="font-mono text-base md:text-xs"
            />
            <Text className="text-muted-foreground text-[12px]">
              {exampleLabel}
              {': '}
              {PROVIDER_OPTIONS_PLACEHOLDER.replace(/\s+/g, ' ')}
            </Text>
          </Stack>
        </div>

        <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
          <HStack justify="end" align="center" gap={2}>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={inFlight}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={inFlight || !isDirty || !validation.ok}
            >
              {saveLabel}
            </Button>
          </HStack>
        </div>
      </Stack>
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
  /** Translated copy. `helpText` renders below the editor inside a CollapsibleGuide. */
  copy: {
    title: string;
    description: string;
    guideLabel: string;
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
      <Text className="text-muted-foreground text-sm whitespace-pre-line">
        {copy.description}
      </Text>
      <JsonInput
        value={value}
        onChange={onChange}
        schema={providerOptionsClientSchema}
        rows={6}
      />
      <CollapsibleGuide label={copy.guideLabel} content={copy.helpText} />
    </Stack>
  );
}

/**
 * Inline JSON editor for a model's `requestBodyMap` (rename/remove wire fields).
 * Same framing as {@link ModelProviderOptionsField}; distinct because the value
 * is meta-config that rewrites the request body rather than passthrough fields.
 */
export function ModelRequestBodyMapField({
  value,
  onChange,
  copy,
}: ModelEditorProps) {
  return (
    <Stack gap={2} className="border-border border-t pt-4">
      <Text className="text-sm font-semibold">{copy.title}</Text>
      <Text className="text-muted-foreground text-sm whitespace-pre-line">
        {copy.description}
      </Text>
      <JsonInput
        value={value}
        onChange={onChange}
        schema={requestBodyMapClientSchema}
        placeholder={REQUEST_BODY_MAP_PLACEHOLDER}
        rows={5}
      />
      <CollapsibleGuide label={copy.guideLabel} content={copy.helpText} />
    </Stack>
  );
}
