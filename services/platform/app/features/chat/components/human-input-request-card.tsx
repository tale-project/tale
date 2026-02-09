'use client';

import { useMutation } from 'convex/react';
import { XCircle, Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { memo, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { HumanInputRequestMetadata } from '@/lib/shared/schemas/approvals';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Label } from '@/app/components/ui/forms/label';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/utils/cn';

interface HumanInputRequestCardProps {
  approvalId: Id<'approvals'>;
  status: 'pending' | 'approved' | 'rejected';
  metadata: HumanInputRequestMetadata;
  className?: string;
  onResponseSubmitted?: () => void;
}

function HumanInputRequestCardComponent({
  approvalId,
  status,
  metadata,
  className,
  onResponseSubmitted,
}: HumanInputRequestCardProps) {
  const { formatDate } = useFormatDate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textValue, setTextValue] = useState('');
  const [selectedValue, setSelectedValue] = useState<string>('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);

  const submitResponse = useMutation(
    api.agent_tools.human_input.mutations.submitHumanInputResponse,
  );

  const isPending = status === 'pending';

  const handleSubmit = async () => {
    let response: string | string[];

    switch (metadata.format) {
      case 'text_input':
        if (!textValue.trim()) {
          setError('Please enter a response');
          return;
        }
        response = textValue.trim();
        break;
      case 'single_select':
      case 'yes_no':
        if (!selectedValue) {
          setError('Please select an option');
          return;
        }
        response = selectedValue;
        break;
      case 'multi_select':
        if (selectedValues.length === 0) {
          setError('Please select at least one option');
          return;
        }
        response = selectedValues;
        break;
      default:
        return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await submitResponse({
        approvalId,
        response,
      });
      onResponseSubmitted?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to submit response',
      );
      console.error('Failed to submit response:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMultiSelectToggle = (value: string) => {
    setSelectedValues((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const getOptionValue = (option: { label: string; value?: string }) =>
    option.value ?? option.label;

  const renderInput = () => {
    switch (metadata.format) {
      case 'text_input':
        return (
          <div className="space-y-2">
            <Textarea
              value={textValue}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setTextValue(e.target.value)
              }
              placeholder={metadata.placeholder ?? 'Type your response...'}
              className="min-h-[80px] text-sm"
              disabled={isSubmitting}
            />
          </div>
        );

      case 'single_select':
      case 'yes_no':
        return (
          <RadioGroup
            value={selectedValue}
            onValueChange={setSelectedValue}
            className="space-y-2"
            disabled={isSubmitting}
          >
            {(metadata.options ?? []).map((option) => {
              const value = getOptionValue(option);
              const isSelected = selectedValue === value;
              return (
                <button
                  type="button"
                  key={value}
                  className={cn(
                    'flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30',
                  )}
                  onClick={() => setSelectedValue(value)}
                >
                  <RadioGroupItem
                    value={value}
                    id={`option-${value}`}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`option-${value}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {option.label}
                    </Label>
                    {option.description && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {option.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </RadioGroup>
        );

      case 'multi_select':
        return (
          <div className="space-y-2">
            {(metadata.options ?? []).map((option) => {
              const value = getOptionValue(option);
              const isChecked = selectedValues.includes(value);
              return (
                <button
                  type="button"
                  key={value}
                  className={cn(
                    'flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer',
                    isChecked
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30',
                  )}
                  onClick={() => handleMultiSelectToggle(value)}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => handleMultiSelectToggle(value)}
                    id={`option-${value}`}
                    disabled={isSubmitting}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`option-${value}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {option.label}
                    </Label>
                    {option.description && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {option.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        );

      default:
        return null;
    }
  };

  const renderResponse = () => {
    if (!metadata.response) return null;

    const { value, respondedBy, timestamp } = metadata.response;
    const displayValue = Array.isArray(value) ? value.join(', ') : value;

    return (
      <div className="bg-muted/50 space-y-2 rounded-lg p-4">
        <div className="text-sm font-medium">{displayValue}</div>
        <div className="text-muted-foreground text-xs">
          Responded by {respondedBy} at{' '}
          {formatDate(new Date(timestamp), 'long')}
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        'border rounded-lg p-5 bg-card shadow-sm w-full max-w-xl',
        status === 'approved' && 'border-success/30 bg-success/5',
        status === 'rejected' && 'border-destructive/30 bg-destructive/5',
        status === 'pending' && 'border-primary/30 bg-primary/5',
        className,
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 rounded-lg p-2">
            <MessageCircleQuestion className="text-primary size-5" />
          </div>
          <div>
            <div className="text-base font-semibold">Question</div>
            <Badge variant="outline" className="mt-1 text-xs capitalize">
              {metadata.format.replace('_', ' ')}
            </Badge>
          </div>
        </div>
        {!isPending && (
          <Badge
            variant={status === 'approved' ? 'green' : 'destructive'}
            className="text-xs capitalize"
          >
            {status === 'approved' ? 'Responded' : status}
          </Badge>
        )}
      </div>

      {/* Question */}
      <div className="mb-4">
        <p className="text-sm leading-relaxed">{metadata.question}</p>
        {metadata.context && (
          <p className="text-muted-foreground mt-2 text-xs">
            {metadata.context}
          </p>
        )}
      </div>

      {/* Input or Response */}
      {isPending ? (
        <div className="space-y-4">
          {renderInput()}

          {/* Error Message */}
          {error && (
            <div className="text-destructive flex items-center gap-1.5 text-xs">
              <XCircle className="size-3.5" />
              {error}
            </div>
          )}

          {/* Submit Button */}
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            Submit Response
          </Button>
        </div>
      ) : (
        renderResponse()
      )}
    </div>
  );
}

export const HumanInputRequestCard = memo(
  HumanInputRequestCardComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.approvalId === nextProps.approvalId &&
      prevProps.status === nextProps.status &&
      prevProps.className === nextProps.className &&
      prevProps.onResponseSubmitted === nextProps.onResponseSubmitted
    );
  },
);
