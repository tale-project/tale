'use client';

import { memo, useCallback } from 'react';

import type { HumanInputField } from '@/lib/shared/schemas/approvals';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Description } from '@/app/components/ui/forms/description';
import { Input } from '@/app/components/ui/forms/input';
import { Label } from '@/app/components/ui/forms/label';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack } from '@/app/components/ui/layout/layout';
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
