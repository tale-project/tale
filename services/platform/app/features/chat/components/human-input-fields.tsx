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
import { useT } from '@/lib/i18n/client';
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
  const { t } = useT('humanInputRequest');

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

  return (
    <Stack gap={4}>
      {fields.map((field) => {
        const fieldId = `form-field-${field.label.replace(/\s+/g, '-').toLowerCase()}`;
        return (
          <Stack key={field.label} gap={1}>
            <Label htmlFor={fieldId} className="text-sm font-medium">
              {field.label}
              {field.required && (
                <span
                  className="text-destructive ml-1"
                  aria-label={t('formFieldRequired')}
                >
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
          >
            {options.map((option) => {
              const value = getOptionValue(option);
              const isSelected = selectedValue === value;
              return (
                <button
                  type="button"
                  key={value}
                  role="radio"
                  aria-checked={isSelected}
                  className={cn(
                    'flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30',
                  )}
                  onClick={() => updateField(field.label, value)}
                >
                  <RadioGroupItem
                    value={value}
                    id={`${fieldId}-${value}`}
                    className="mt-0.5"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`${fieldId}-${value}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {option.label}
                    </Label>
                    {option.description && (
                      <Description className="mt-1 text-xs">
                        {option.description}
                      </Description>
                    )}
                  </div>
                </button>
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
                <button
                  type="button"
                  key={value}
                  aria-pressed={isChecked}
                  className={cn(
                    'flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer',
                    isChecked
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30',
                  )}
                  onClick={() => toggleMultiSelect(field.label, value)}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() =>
                      toggleMultiSelect(field.label, value)
                    }
                    id={`${fieldId}-${value}`}
                    disabled={disabled}
                    className="mt-0.5"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`${fieldId}-${value}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {option.label}
                    </Label>
                    {option.description && (
                      <Description className="mt-1 text-xs">
                        {option.description}
                      </Description>
                    )}
                  </div>
                </button>
              );
            })}
          </Stack>
        );
      }

      default:
        return null;
    }
  }
}

export const HumanInputFields = memo(HumanInputFieldsComponent);
