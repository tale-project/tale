'use client';

import { Code2, Info, Save, X } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { z } from 'zod';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Description } from '@/app/components/ui/forms/description';
import { Label } from '@/app/components/ui/forms/label';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';

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
  base0A: 'rgba(70, 70, 230, 1)',
  base0B: 'rgba(70, 70, 230, 1)',
  base0C: 'rgba(70, 70, 230, 1)',
  base0D: 'rgba(70, 70, 230, 1)',
  base0E: 'rgba(70, 70, 230, 1)',
  base0F: 'rgba(70, 70, 230, 1)',
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
  fontSize: number;
  inputId: string;
  describedBy: string | undefined;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

function JsonTextEditor({
  textValue,
  disabled,
  rows,
  fontSize,
  inputId,
  describedBy,
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
        'w-full resize-none border-0 bg-transparent p-3 text-xs focus:outline-none focus:ring-0 min-h-[12.5rem] overflow-y-auto',
        'font-mono leading-relaxed',
        'placeholder:text-muted-foreground',
        theme === 'dark'
          ? 'text-foreground bg-background'
          : 'text-foreground bg-card',
      )}
      style={{
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: `${fontSize}px`,
        lineHeight: '1.4',
      }}
      placeholder={JSON.stringify({ key: 'value' }, null, 2)}
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
            .map((e) => `${e.path.join('.')}: ${e.message}`)
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

export function JsonInput({
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
  fontSize = 12,
  id,
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
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between">
        {label && (
          <Label htmlFor={resolvedId} required={required} error={hasAnyError}>
            {label}
          </Label>
        )}
        {!disabled && (
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
        )}
      </div>

      <div
        ref={containerRef}
        className={cn(
          'border rounded-md overflow-hidden bg-card',
          hasAnyError && 'border-destructive',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
        role="group"
        aria-describedby={describedBy}
      >
        {editing.isEditing ? (
          <JsonTextEditor
            textValue={textValue}
            disabled={disabled}
            rows={rows}
            fontSize={fontSize}
            inputId={resolvedId}
            describedBy={describedBy}
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

      {displayError && (
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
      )}

      {editing.isEditing && (
        <Text
          as="div"
          variant="caption"
          className="flex items-center justify-between"
        >
          <div>
            Press{' '}
            <kbd className="bg-muted rounded px-1 py-0.5 text-xs">
              {t('keyboardShortcuts.ctrlEnter')}
            </kbd>{' '}
            to save,{' '}
            <kbd className="bg-muted rounded px-1 py-0.5 text-xs">
              {t('keyboardShortcuts.escape')}
            </kbd>{' '}
            to cancel
          </div>
          {editing.isDirty && (
            <span className="font-medium text-amber-600">
              {t('unsavedChanges')}
            </span>
          )}
        </Text>
      )}

      {description && (
        <Description id={descriptionId} className="text-xs">
          {description}
        </Description>
      )}
    </div>
  );
}
