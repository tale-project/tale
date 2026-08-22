'use client';

import { Button } from '@tale/ui/button';
import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useTheme } from '@tale/ui/theme';
import { Code2, Info, Save, X } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { z } from 'zod';

import { Label } from '@/app/components/ui/forms/label';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';

import { FieldShell } from './field-shell';
import { Textarea } from './textarea';

const ReactJsonView = lazyComponent(
  () => import('@microlink/react-json-view'),
  {
    loading: () => (
      <div className="bg-muted rounded-md p-4">
        <div className="animate-pulse">
          <div className="mb-2 h-4 w-1/4 rounded bg-gray-300"></div>
          <div className="mb-2 h-4 w-1/2 rounded bg-gray-300"></div>
          <div className="h-4 w-3/4 rounded bg-gray-300"></div>
        </div>
      </div>
    ),
  },
);

interface ValidationState {
  isValid: boolean;
  error: string;
}

interface EditingState {
  isEditing: boolean;
  isDirty: boolean;
}

interface JsonEditorToolbarProps {
  editing: EditingState;
  validation: ValidationState;
  onSave: () => void;
  onCancel: () => void;
  onSourceClick: () => void;
  t: (key: string) => string;
}

function JsonEditorToolbar({
  editing,
  validation,
  onSave,
  onCancel,
  onSourceClick,
  t,
}: JsonEditorToolbarProps) {
  if (editing.isEditing) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSave}
          disabled={!validation.isValid || !editing.isDirty}
          className="h-6 px-2 text-green-600 hover:bg-green-50 hover:text-green-700"
        >
          <Save className="mr-1 size-3" />
          {t('actions.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-foreground hover:text-foreground/80 hover:bg-muted h-6 px-2"
        >
          <X className="mr-1 size-3" />
          {t('actions.cancel')}
        </Button>
      </>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onSourceClick}
      className="h-6 px-2"
    >
      <Code2 className="mr-1 size-3" />
      {t('actions.source')}
    </Button>
  );
}

const JSON_VIEWER_THEME = {
  base00: 'hsl(var(--background))',
  base01: 'hsl(var(--muted))',
  base02: 'hsl(var(--muted))',
  base03: 'hsl(var(--foreground))',
  base04: 'hsl(var(--foreground))',
  base05: 'hsl(var(--foreground))',
  base06: 'hsl(var(--muted-foreground))',
  base07: 'hsl(var(--foreground))',
  base08: 'hsl(var(--foreground))',
  base09: 'hsl(var(--destructive))',
  // One themed accent for all value types (the literal rgba it replaces never
  // switched with the theme; --primary resolves per theme like base00-09).
  base0A: 'hsl(var(--primary))',
  base0B: 'hsl(var(--primary))',
  base0C: 'hsl(var(--primary))',
  base0D: 'hsl(var(--primary))',
  base0E: 'hsl(var(--primary))',
  base0F: 'hsl(var(--primary))',
};

interface JsonViewerDisplayProps {
  parsedValue: unknown;
  indentWidth: number;
  fontSize: number;
  disabled: boolean;
  describedBy: string | undefined;
  onEdit: ((edit: { updated_src: unknown }) => boolean) | false;
}

function JsonViewerDisplay({
  parsedValue,
  indentWidth,
  fontSize,
  disabled,
  describedBy,
  onEdit,
}: JsonViewerDisplayProps) {
  return (
    <div className="p-3" aria-describedby={describedBy}>
      <ReactJsonView
        name={false}
        quotesOnKeys
        indentWidth={indentWidth}
        enableClipboard
        src={parsedValue}
        displayObjectSize={false}
        displayDataTypes={false}
        collapsed={false}
        sortKeys={false}
        collapseStringsAfterLength={80}
        theme={JSON_VIEWER_THEME}
        onEdit={!disabled ? onEdit : false}
        onAdd={!disabled ? onEdit : false}
        onDelete={!disabled ? onEdit : false}
        style={{
          backgroundColor: 'transparent',
          fontSize: `${fontSize}px`,
          minHeight: '12.5rem',
        }}
      />
    </div>
  );
}

interface JsonTextEditorProps {
  textValue: string;
  disabled: boolean;
  rows: number;
  inputId: string;
  describedBy: string | undefined;
  placeholder: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

function JsonTextEditor({
  textValue,
  disabled,
  rows,
  inputId,
  describedBy,
  placeholder,
  onChange,
  onKeyDown,
}: JsonTextEditorProps) {
  const { theme } = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <Textarea
      ref={textareaRef}
      value={textValue}
      onChange={onChange}
      onKeyDown={onKeyDown}
      disabled={disabled}
      rows={rows}
      id={inputId}
      aria-describedby={describedBy}
      className={cn(
        // text-base (≥16px) on mobile prevents iOS focus-zoom; md:text-xs keeps
        // the dense monospace editor on desktop.
        'min-h-[12.5rem] w-full resize-none overflow-y-auto border-0 bg-transparent p-3 text-base focus:ring-0 focus:outline-none md:text-xs',
        'font-mono leading-relaxed',
        'placeholder:text-muted-foreground',
        theme === 'dark'
          ? 'text-foreground bg-background'
          : 'text-foreground bg-card',
      )}
      style={{
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        lineHeight: '1.4',
      }}
      placeholder={placeholder}
    />
  );
}

function computeValidation(
  jsonString: string,
  schema: z.ZodSchema | undefined,
  t: (key: string, params?: Record<string, string>) => string,
): ValidationState {
  if (!jsonString.trim()) {
    return { isValid: true, error: '' };
  }

  try {
    const parsed = JSON.parse(jsonString);

    if (schema) {
      try {
        schema.parse(parsed);
        return { isValid: true, error: '' };
      } catch (err) {
        if (err instanceof z.ZodError) {
          const validationError = err.issues
            .map((e) =>
              e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message,
            )
            .join(', ');
          return {
            isValid: false,
            error: t('validation.schemaValidationFailed', {
              error: validationError,
            }),
          };
        }
        return {
          isValid: false,
          error: t('validation.schemaValidationFailed', { error: '' }),
        };
      }
    }

    return { isValid: true, error: '' };
  } catch (err) {
    return {
      isValid: false,
      error: err instanceof Error ? err.message : t('validation.invalidJson'),
    };
  }
}

interface JsonInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  indentWidth?: number;
  schema?: z.ZodSchema;
  description?: React.ReactNode;
  errorMessage?: string;
  required?: boolean;
  className?: string;
  rows?: number;
  fontSize?: number;
  id?: string;
}

// Plain control — the real JSON viewer/editor body (+ toolbar, label,
// description, errors). No skeleton logic of its own.
function JsonInputBase({
  value,
  onChange,
  disabled = false,
  indentWidth = 2,
  label,
  schema,
  description,
  errorMessage,
  required,
  className,
  rows = 4,
  fontSize = 16,
  id,
  placeholder = JSON.stringify({ key: 'value' }, null, 2),
}: JsonInputProps) {
  const { t } = useT('common');
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const errorId = `${resolvedId}-error`;
  const descriptionId = `${resolvedId}-description`;

  const [editing, setEditing] = useState<EditingState>({
    isEditing: false,
    isDirty: false,
  });
  const [textValue, setTextValue] = useState(() => value);
  const [parsedValue, setParsedValue] = useState(() => {
    try {
      return value.trim() ? JSON.parse(value) : {};
    } catch {
      return {};
    }
  });
  const [validation, setValidation] = useState<ValidationState>(() =>
    computeValidation(value, schema, t),
  );

  const prevValueRef = useRef(value);
  const shakeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (prevValueRef.current !== value) {
    prevValueRef.current = value;
    try {
      const parsed = value.trim() ? JSON.parse(value) : {};
      setParsedValue(parsed);
    } catch {
      setParsedValue({});
    }
    setTextValue(value);
    setEditing({ isEditing: false, isDirty: false });
    setValidation(computeValidation(value, schema, t));
  }

  const validateJson = useCallback(
    (jsonString: string): boolean => {
      const result = computeValidation(jsonString, schema, t);
      setValidation(result);
      return result.isValid;
    },
    [schema, t],
  );

  const hasExternalError = !!errorMessage;
  const hasAnyError =
    hasExternalError || (!validation.isValid && !!validation.error);
  const displayError =
    errorMessage ??
    (!validation.isValid && validation.error ? validation.error : undefined);
  const describedBy =
    [description && descriptionId, hasAnyError && errorId]
      .filter(Boolean)
      .join(' ') || undefined;

  useEffect(() => {
    if (hasAnyError && containerRef.current) {
      containerRef.current.classList.add('animate-shake');
      if (shakeRef.current) {
        clearTimeout(shakeRef.current);
      }
      shakeRef.current = setTimeout(() => {
        containerRef.current?.classList.remove('animate-shake');
        shakeRef.current = null;
      }, 400);
    }
    return () => {
      if (shakeRef.current) {
        clearTimeout(shakeRef.current);
      }
    };
  }, [hasAnyError, displayError]);

  const handleSourceClick = () => {
    setTextValue(JSON.stringify(parsedValue, null, 2));
    setEditing({ isEditing: true, isDirty: false });
  };

  const handleSave = () => {
    if (validateJson(textValue)) {
      try {
        const parsed = JSON.parse(textValue);
        setParsedValue(parsed);
        onChange(textValue);
        setEditing({ isEditing: false, isDirty: false });
      } catch (err) {
        toast({
          title:
            err instanceof Error ? err.message : t('validation.invalidJson'),
          variant: 'destructive',
        });
      }
    }
  };

  const handleCancel = () => {
    const restoredValue = JSON.stringify(parsedValue, null, 2);
    setTextValue(restoredValue);
    setEditing({ isEditing: false, isDirty: false });
    setValidation(computeValidation(restoredValue, schema, t));
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setTextValue(newValue);
    validateJson(newValue);
    const originalValue = JSON.stringify(parsedValue, null, 2);
    setEditing((prev) => ({ ...prev, isDirty: newValue !== originalValue }));
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const tabChar = '  ';
      const newValue =
        textValue.slice(0, start) + tabChar + textValue.slice(end);
      setTextValue(newValue);
      validateJson(newValue);
      const originalValue = JSON.stringify(parsedValue, null, 2);
      setEditing((prev) => ({ ...prev, isDirty: newValue !== originalValue }));
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd =
          start + tabChar.length;
      }, 0);
    }
  };

  const handleJsonEdit = useCallback(
    (edit: { updated_src: unknown }) => {
      try {
        const newJsonString = JSON.stringify(edit.updated_src, null, 2);
        if (validateJson(newJsonString)) {
          setParsedValue(edit.updated_src);
          onChange(newJsonString);
          return true;
        }
        return false;
      } catch (err) {
        console.error('Error handling JSON edit:', err);
        return false;
      }
    },
    [validateJson, onChange],
  );

  return (
    <FieldShell
      // A JSON editor is a code surface, not a one-line value: it keeps the
      // full width of the control column even in label-left layouts.
      wideControl
      {...(label
        ? {
            label: (
              <Label
                htmlFor={resolvedId}
                required={required}
                error={hasAnyError}
              >
                {label}
              </Label>
            ),
          }
        : {})}
      {...(description
        ? {
            description: (
              <Description id={descriptionId}>{description}</Description>
            ),
          }
        : {})}
      {...(displayError !== undefined
        ? {
            error: (
              <Text
                id={errorId}
                role="alert"
                aria-live="polite"
                variant="error"
                className="flex items-center gap-1.5"
              >
                <Info className="size-4 shrink-0" aria-hidden="true" />
                {displayError}
              </Text>
            ),
          }
        : {})}
      {...(className !== undefined ? { className } : {})}
    >
      {/* The frame owns the label now, so the toolbar has this row to itself —
          pinned right, directly above the editor it acts on. */}
      {!disabled && (
        <div className="flex items-center justify-end">
          <div className="flex gap-1">
            <JsonEditorToolbar
              editing={editing}
              validation={validation}
              onSave={handleSave}
              onCancel={handleCancel}
              onSourceClick={handleSourceClick}
              t={t}
            />
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          'bg-card overflow-hidden rounded-md border',
          hasAnyError && 'border-destructive',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        role="group"
        aria-describedby={describedBy}
      >
        {editing.isEditing ? (
          <JsonTextEditor
            textValue={textValue}
            disabled={disabled}
            rows={rows}
            inputId={resolvedId}
            describedBy={describedBy}
            placeholder={placeholder}
            onChange={handleTextareaChange}
            onKeyDown={handleTextareaKeyDown}
          />
        ) : (
          <JsonViewerDisplay
            parsedValue={parsedValue}
            indentWidth={indentWidth}
            fontSize={fontSize}
            disabled={disabled}
            describedBy={describedBy}
            onEdit={handleJsonEdit}
          />
        )}
      </div>

      {editing.isEditing && (
        <Text
          as="div"
          variant="caption"
          className="flex items-center justify-between"
        >
          <div>
            <kbd className="bg-muted rounded px-1 py-0.5 text-xs">
              {t('keyboardShortcuts.ctrlEnter')}
            </kbd>{' '}
            {t('keyboardShortcuts.hintToSave')}{' '}
            <kbd className="bg-muted rounded px-1 py-0.5 text-xs">
              {t('keyboardShortcuts.escape')}
            </kbd>{' '}
            {t('keyboardShortcuts.hintToCancel')}
          </div>
          {editing.isDirty && (
            <span className="text-warning font-medium">
              {t('unsavedChanges.title')}
            </span>
          )}
        </Text>
      )}
    </FieldShell>
  );
}

/**
 * Skeleton-aware JsonInput. Inside a `<Skeletonize loading>` it masks the plain
 * control by rendering it inside a `<SkeletonBox>` — laid out invisibly to set
 * the exact size, pulse overlay on top — so the skeleton can never drift.
 */
export function JsonInput(props: JsonInputProps) {
  const loading = useSkeleton();
  if (loading) {
    return (
      <SkeletonBox>
        <JsonInputBase {...props} />
      </SkeletonBox>
    );
  }
  return <JsonInputBase {...props} />;
}
