'use client';

import { Button } from '@tale/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Description } from '@/app/components/ui/forms/description';
import { Input } from '@/app/components/ui/forms/input';
import { Label } from '@/app/components/ui/forms/label';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import type {
  HumanInputField,
  HumanInputTodoItem,
} from '@/lib/shared/schemas/approvals';
import { cn } from '@/lib/utils/cn';

interface HumanInputFieldsProps {
  fields: HumanInputField[];
  disabled?: boolean;
  formValues: Record<string, string | string[]>;
  onFormValuesChange: (values: Record<string, string | string[]>) => void;
}

const getOptionValue = (option: { label: string; value?: string }) =>
  option.value ?? option.label;

const asString = (val: string | string[] | undefined): string =>
  typeof val === 'string' ? val : '';

const asStringArray = (val: string | string[] | undefined): string[] =>
  Array.isArray(val) ? val : [];

function HumanInputFieldsComponent({
  fields,
  disabled = false,
  formValues,
  onFormValuesChange,
}: HumanInputFieldsProps) {
  const updateField = useCallback(
    (label: string, value: string | string[]) => {
      onFormValuesChange({ ...formValues, [label]: value });
    },
    [formValues, onFormValuesChange],
  );

  const toggleMultiSelect = useCallback(
    (fieldLabel: string, optionValue: string) => {
      const current = asStringArray(formValues[fieldLabel]);
      const updated = current.includes(optionValue)
        ? current.filter((item) => item !== optionValue)
        : [...current, optionValue];
      updateField(fieldLabel, updated);
    },
    [formValues, updateField],
  );

  function renderFieldInput(field: HumanInputField, fieldId: string) {
    switch (field.type) {
      case 'textarea':
        return (
          <Textarea
            id={fieldId}
            value={asString(formValues[field.label])}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              updateField(field.label, e.target.value)
            }
            className="min-h-[80px] text-sm"
            disabled={disabled}
          />
        );

      case 'text':
      case 'number':
      case 'email':
      case 'url':
      case 'tel':
        return (
          <Input
            id={fieldId}
            type={field.type}
            value={asString(formValues[field.label])}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              updateField(field.label, e.target.value)
            }
            disabled={disabled}
          />
        );

      case 'single_select':
      case 'yes_no': {
        const options = field.options ?? [];
        const selectedValue = asString(formValues[field.label]);
        return (
          <RadioGroup
            value={selectedValue}
            onValueChange={(val: string) => updateField(field.label, val)}
            className="space-y-2"
            disabled={disabled}
            aria-label={field.label}
          >
            {options.map((option) => {
              const value = getOptionValue(option);
              const isSelected = selectedValue === value;
              return (
                <label
                  key={value}
                  className={cn(
                    'flex items-start space-x-3 p-3 rounded-lg border transition-all',
                    disabled
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30',
                  )}
                >
                  <RadioGroupItem
                    value={value}
                    id={`${fieldId}-${value}`}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{option.label}</span>
                    {option.description && (
                      <Description className="mt-1 text-xs">
                        {option.description}
                      </Description>
                    )}
                  </div>
                </label>
              );
            })}
          </RadioGroup>
        );
      }

      case 'multi_select': {
        const options = field.options ?? [];
        const selectedValues = asStringArray(formValues[field.label]);
        return (
          <Stack gap={2}>
            {options.map((option) => {
              const value = getOptionValue(option);
              const isChecked = selectedValues.includes(value);
              return (
                <label
                  key={value}
                  className={cn(
                    'flex items-start space-x-3 p-3 rounded-lg border transition-all',
                    disabled
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer',
                    isChecked
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30',
                  )}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() =>
                      toggleMultiSelect(field.label, value)
                    }
                    id={`${fieldId}-${value}`}
                    disabled={disabled}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{option.label}</span>
                    {option.description && (
                      <Description className="mt-1 text-xs">
                        {option.description}
                      </Description>
                    )}
                  </div>
                </label>
              );
            })}
          </Stack>
        );
      }

      case 'todo_list':
        return (
          <TodoListFieldInput
            fieldLabel={field.label}
            fieldId={fieldId}
            initialTodos={
              'initialTodos' in field && Array.isArray(field.initialTodos)
                ? field.initialTodos
                : []
            }
            minItems={
              'minItems' in field && typeof field.minItems === 'number'
                ? field.minItems
                : 0
            }
            maxItems={
              'maxItems' in field && typeof field.maxItems === 'number'
                ? field.maxItems
                : 20
            }
            rawValue={asString(formValues[field.label])}
            disabled={disabled}
            onChange={(serialized) => updateField(field.label, serialized)}
          />
        );

      default:
        return null;
    }
  }

  return (
    <Stack gap={4}>
      {fields.map((field) => {
        const fieldId = `form-field-${field.label.replace(/\s+/g, '-').toLowerCase()}`;
        return (
          <Stack key={field.label} gap={1}>
            <Label htmlFor={fieldId} className="text-sm font-medium">
              {field.label}
              {field.required && (
                <span className="text-destructive ml-1" aria-hidden="true">
                  *
                </span>
              )}
            </Label>
            {field.description && (
              <Description className="text-xs">{field.description}</Description>
            )}
            {renderFieldInput(field, fieldId)}
          </Stack>
        );
      })}
    </Stack>
  );
}

export const HumanInputFields = memo(HumanInputFieldsComponent);

interface TodoListFieldInputProps {
  fieldLabel: string;
  fieldId: string;
  initialTodos: HumanInputTodoItem[];
  minItems: number;
  maxItems: number;
  rawValue: string;
  disabled: boolean;
  onChange: (serialized: string) => void;
}

function parseTodoList(rawValue: string): HumanInputTodoItem[] | null {
  if (!rawValue) return null;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return null;
    const result: HumanInputTodoItem[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const record: { id?: unknown; content?: unknown } = item;
      if (typeof record.id === 'string' && typeof record.content === 'string') {
        result.push({ id: record.id, content: record.content });
      }
    }
    return result;
  } catch {
    return null;
  }
}

function makeTodoId(seed: number): string {
  return `t${seed}-${Math.random().toString(36).slice(2, 6)}`;
}

function TodoListFieldInput({
  fieldLabel,
  fieldId,
  initialTodos,
  minItems,
  maxItems,
  rawValue,
  disabled,
  onChange,
}: TodoListFieldInputProps) {
  const initialParsed = useMemo(() => parseTodoList(rawValue), [rawValue]);
  const [items, setItems] = useState<HumanInputTodoItem[]>(() => {
    if (initialParsed && initialParsed.length > 0) return initialParsed;
    return initialTodos.length > 0
      ? initialTodos.map((t) => ({ ...t }))
      : [{ id: makeTodoId(0), content: '' }];
  });
  const seedRef = useRef(items.length);
  const lastSerialized = useRef('');

  const serialized = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    if (serialized === lastSerialized.current) return;
    lastSerialized.current = serialized;
    onChange(serialized);
  }, [serialized, onChange]);

  const updateContent = useCallback((id: string, value: string) => {
    setItems((prev) =>
      prev.map((todo) => (todo.id === id ? { ...todo, content: value } : todo)),
    );
  }, []);

  const addRow = useCallback(() => {
    if (items.length >= maxItems) return;
    setItems((prev) => [
      ...prev,
      { id: makeTodoId(seedRef.current++), content: '' },
    ]);
  }, [items.length, maxItems]);

  const removeRow = useCallback(
    (id: string) => {
      setItems((prev) => {
        if (prev.length <= Math.max(1, minItems)) return prev;
        return prev.filter((todo) => todo.id !== id);
      });
    },
    [minItems],
  );

  return (
    <Stack gap={2} role="list" aria-label={fieldLabel}>
      {items.map((todo, index) => (
        <HStack key={todo.id} align="center" gap={2} role="listitem">
          <span
            className="text-muted-foreground shrink-0 font-mono text-xs"
            aria-hidden="true"
          >
            {index + 1}.
          </span>
          <Input
            id={`${fieldId}-${todo.id}`}
            value={todo.content}
            placeholder={`Sub-question ${index + 1}`}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              updateContent(todo.id, e.target.value)
            }
            disabled={disabled}
            aria-label={`${fieldLabel} item ${index + 1}`}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => removeRow(todo.id)}
            disabled={disabled || items.length <= Math.max(1, minItems)}
            aria-label={`Remove item ${index + 1}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </HStack>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={addRow}
        disabled={disabled || items.length >= maxItems}
        className="gap-1 self-start"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add item
      </Button>
    </Stack>
  );
}
