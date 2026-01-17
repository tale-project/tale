'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Label } from '@/app/components/ui/forms/label';
import { Button } from '@/app/components/ui/primitives/button';
import { cn } from '@/lib/utils/cn';
import { useTheme } from '@/app/components/theme/theme-provider';
import { Code2, Save, X } from 'lucide-react';
import { Textarea } from './textarea';
import { z } from 'zod';
import { toast } from '@/app/hooks/use-toast';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { useT } from '@/lib/i18n/client';

const ReactJsonView = lazyComponent(() => import('@microlink/react-json-view'), {
  loading: () => (
    <div className="bg-muted p-4 rounded-md">
      <div className="animate-pulse">
        <div className="h-4 bg-gray-300 rounded w-1/4 mb-2"></div>
        <div className="h-4 bg-gray-300 rounded w-1/2 mb-2"></div>
        <div className="h-4 bg-gray-300 rounded w-3/4"></div>
      </div>
    </div>
  ),
});
interface JsonInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  indentWidth?: number;
  schema?: z.ZodSchema;
  description?: string;
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
  className,
  rows = 4,
  fontSize = 12,
  id,
}: JsonInputProps) {
  const { t } = useT('common');
  const [isEditing, setIsEditing] = useState(false);
  const [textValue, setTextValue] = useState(value);
  const [parsedValue, setParsedValue] = useState(() => {
    try {
      return value.trim() ? JSON.parse(value) : {};
    } catch {
      return {};
    }
  });
  const [isValid, setIsValid] = useState(true);
  const [error, setError] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const { theme } = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Validate JSON and schema
  const validateJson = useCallback(
    (jsonString: string) => {
      if (!jsonString.trim()) {
        setIsValid(true);
        setError('');
        return true;
      }

      try {
        const parsed = JSON.parse(jsonString);

        // If schema is provided, validate against it
        if (schema) {
          try {
            schema.parse(parsed);
            setIsValid(true);
            setError('');
            return true;
          } catch (err) {
            if (err instanceof z.ZodError) {
              const zodError = err as z.ZodError<unknown>;
              const errorMessage = zodError.issues
                .map((e) => `${e.path.join('.')}: ${e.message}`)
                .join(', ');
              setIsValid(false);
              setError(t('validation.schemaValidationFailed', { error: errorMessage }));
            } else {
              setIsValid(false);
              setError(t('validation.schemaValidationFailed', { error: '' }));
            }
            return false;
          }
        } else {
          setIsValid(true);
          setError('');
          return true;
        }
      } catch (err) {
        setIsValid(false);
        setError(err instanceof Error ? err.message : t('validation.invalidJson'));
        return false;
      }
    },
    [schema, t],
  );

  // Validate initial value and when schema changes
  useEffect(() => {
    validateJson(value);
  }, [value, validateJson]);

  // Handle switching to source mode (textarea)
  const handleSourceClick = () => {
    setTextValue(JSON.stringify(parsedValue, null, 2));
    setIsEditing(true);
    setIsDirty(false);
  };

  // Handle save action
  const handleSave = () => {
    if (validateJson(textValue)) {
      try {
        const parsed = JSON.parse(textValue);
        setParsedValue(parsed);
        onChange(textValue);
        setIsDirty(false);
        setIsEditing(false);
      } catch (err) {
        toast({
          title: err instanceof Error ? err.message : t('validation.invalidJson'),
          variant: 'destructive',
        });
        // Stay in edit mode if invalid
        return;
      }
    }
  };

  // Handle cancel action
  const handleCancel = () => {
    setTextValue(JSON.stringify(parsedValue, null, 2));
    setIsDirty(false);
    setIsEditing(false);
    setIsValid(true);
    setError('');
  };

  // Handle textarea changes
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setTextValue(newValue);
    validateJson(newValue);

    // Mark as dirty if value has changed from original
    const originalValue = JSON.stringify(parsedValue, null, 2);
    setIsDirty(newValue !== originalValue);
  };

  // Handle textarea key events
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

      // Insert tab character(s) at cursor position
      const tabChar = '  '; // 2 spaces to match JSON formatting
      const newValue =
        textValue.substring(0, start) + tabChar + textValue.substring(end);

      setTextValue(newValue);
      validateJson(newValue);

      // Mark as dirty if value has changed from original
      const originalValue = JSON.stringify(parsedValue, null, 2);
      setIsDirty(newValue !== originalValue);

      // Move cursor to after the inserted tab
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd =
          start + tabChar.length;
      }, 0);
    }
  };

  // Handle edits from the JSON viewer
  const handleJsonEdit = (edit: { updated_src: unknown }) => {
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
  };

  // Update parsed value when value prop changes
  React.useEffect(() => {
    try {
      const parsed = value.trim() ? JSON.parse(value) : {};
      setParsedValue(parsed);
      setTextValue(value);
      setIsDirty(false); // Reset dirty state when external value changes
    } catch {
      setParsedValue({});
      setTextValue(value);
      setIsDirty(false);
    }
  }, [value]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        {label && <Label htmlFor={id}>{label}</Label>}
        {!disabled && (
          <div className="flex gap-1">
            {isEditing ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleSave}
                  disabled={!isValid || !isDirty}
                  className="h-6 px-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                >
                  <Save className="size-3 mr-1" />
                  {t('actions.save')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  className="h-6 px-2 text-foreground hover:text-foreground/80 hover:bg-muted"
                >
                  <X className="size-3 mr-1" />
                  {t('actions.cancel')}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSourceClick}
                className="h-6 px-2"
              >
                <Code2 className="size-3 mr-1" />
                {t('actions.source')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div
        className={cn(
          'border rounded-md overflow-hidden bg-card',
          !isValid && 'border-destructive',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        {isEditing ? (
          <Textarea
            ref={textareaRef}
            value={textValue}
            onChange={handleTextareaChange}
            onKeyDown={handleTextareaKeyDown}
            disabled={disabled}
            rows={rows}
            className={cn(
              'w-full resize-none border-0 bg-transparent p-3 text-xs focus:outline-none focus:ring-0 h-[12.5rem] overflow-y-auto',
              'font-mono leading-relaxed',
              'placeholder:text-muted-foreground',
              // Mirror JSON viewer styling
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
        ) : (
          <div className="p-3">
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
              theme={{
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
              }}
              onEdit={!disabled ? handleJsonEdit : false}
              onAdd={!disabled ? handleJsonEdit : false}
              onDelete={!disabled ? handleJsonEdit : false}
              style={{
                backgroundColor: 'transparent',
                fontSize: `${fontSize}px`,
                minHeight: '12.5rem',
              }}
            />
          </div>
        )}
      </div>

      {!isValid && error && <p className="text-xs text-destructive">{error}</p>}

      {isEditing && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Press{' '}
            <kbd className="px-1 py-0.5 text-xs bg-muted rounded">
              {t('keyboardShortcuts.ctrlEnter')}
            </kbd>{' '}
            to save,{' '}
            <kbd className="px-1 py-0.5 text-xs bg-muted rounded">{t('keyboardShortcuts.escape')}</kbd> to
            cancel
          </div>
          {isDirty && (
            <span className="text-amber-600 font-medium">{t('unsavedChanges')}</span>
          )}
        </div>
      )}

      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
