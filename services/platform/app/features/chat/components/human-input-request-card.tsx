'use client';

import {
  XCircle,
  Loader2,
  MessageCircleQuestion,
  Send,
  Square,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { HumanInputRequestMetadata } from '@/lib/shared/schemas/approvals';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Description } from '@/app/components/ui/forms/description';
import { Label } from '@/app/components/ui/forms/label';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { stripLeadingPunctuation } from '@/lib/utils/text';

import { useSubmitHumanInputResponse } from '../hooks/mutations';
import { useCancelExecution } from '../hooks/use-execution-status';

const OTHER_VALUE = '__other__';

interface HumanInputRequestCardProps {
  approvalId: Id<'approvals'>;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: HumanInputRequestMetadata;
  isWorkflowContext?: boolean;
  wfExecutionId?: Id<'wfExecutions'>;
  className?: string;
  onResponseSubmitted?: () => void;
}

function HumanInputRequestCardComponent({
  approvalId,
  status,
  metadata,
  isWorkflowContext,
  wfExecutionId,
  className,
  onResponseSubmitted,
}: HumanInputRequestCardProps) {
  const { t } = useT('humanInputRequest');
  const { t: tCommon } = useT('approvalCommon');
  const { formatDate } = useFormatDate();
  const [error, setError] = useState<string | null>(null);
  const [textValue, setTextValue] = useState('');
  const [otherText, setOtherText] = useState('');
  const [selectedValue, setSelectedValue] = useState<string>('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);

  const { mutate: submitResponse, isPending: isSubmitting } =
    useSubmitHumanInputResponse();
  const { mutateAsync: cancelExecution } = useCancelExecution();
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancel = useCallback(async () => {
    if (!wfExecutionId) return;
    setIsCancelling(true);
    setError(null);
    try {
      await cancelExecution({
        executionId: wfExecutionId,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tCommon('errorSubmitFailed'),
      );
      console.error('Failed to cancel execution:', err);
    } finally {
      setIsCancelling(false);
    }
  }, [wfExecutionId, cancelExecution, tCommon]);

  const isPending = status === 'pending';

  const handleSubmit = useCallback(() => {
    let response: string | string[];

    switch (metadata.format) {
      case 'text_input':
        if (!textValue.trim()) {
          setError(t('errorEnterResponse'));
          return;
        }
        response = textValue.trim();
        break;
      case 'single_select':
      case 'yes_no':
        if (!selectedValue) {
          setError(t('errorSelectOption'));
          return;
        }
        if (selectedValue === OTHER_VALUE) {
          if (!otherText.trim()) {
            setError(t('errorEnterOtherResponse'));
            return;
          }
          response = otherText.trim();
        } else {
          response = selectedValue;
        }
        break;
      case 'multi_select':
        if (selectedValues.length === 0) {
          setError(t('errorSelectAtLeastOne'));
          return;
        }
        if (selectedValues.includes(OTHER_VALUE)) {
          if (!otherText.trim()) {
            setError(t('errorEnterOtherResponse'));
            return;
          }
          response = [
            ...selectedValues.filter((v) => v !== OTHER_VALUE),
            otherText.trim(),
          ];
        } else {
          response = selectedValues;
        }
        break;
      default:
        return;
    }

    setError(null);

    submitResponse(
      { approvalId, response },
      {
        onSuccess: () => {
          if (!isWorkflowContext) {
            onResponseSubmitted?.();
          }
        },
        onError: (err) => {
          setError(
            err instanceof Error ? err.message : tCommon('errorSubmitFailed'),
          );
          console.error('Failed to submit response:', err);
        },
      },
    );
  }, [
    t,
    tCommon,
    metadata.format,
    textValue,
    otherText,
    selectedValue,
    selectedValues,
    isWorkflowContext,
    approvalId,
    submitResponse,
    onResponseSubmitted,
  ]);

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
          <Stack gap={2}>
            <Textarea
              value={textValue}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setTextValue(e.target.value)
              }
              placeholder={t('placeholder')}
              className="min-h-[80px] text-sm"
              disabled={isSubmitting}
            />
          </Stack>
        );

      case 'single_select':
      case 'yes_no': {
        const isOtherSelected = selectedValue === OTHER_VALUE;
        return (
          <Stack gap={2}>
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
                    role="radio"
                    aria-checked={isSelected}
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
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor={`option-${value}`}
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
              <button
                type="button"
                role="radio"
                aria-checked={isOtherSelected}
                className={cn(
                  'flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer border-dashed',
                  isOtherSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/30',
                )}
                onClick={() => setSelectedValue(OTHER_VALUE)}
              >
                <RadioGroupItem
                  value={OTHER_VALUE}
                  id="option-other"
                  className="mt-0.5"
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="option-other"
                    className="cursor-pointer text-sm font-medium"
                  >
                    {t('otherOption')}
                  </Label>
                  <Description className="mt-1 text-xs">
                    {t('otherOptionDescription')}
                  </Description>
                </div>
              </button>
            </RadioGroup>
            {isOtherSelected && (
              <Textarea
                value={otherText}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setOtherText(e.target.value)
                }
                placeholder={t('placeholder')}
                className="min-h-[80px] text-sm"
                disabled={isSubmitting}
                autoFocus
              />
            )}
          </Stack>
        );
      }

      case 'multi_select': {
        const isOtherChecked = selectedValues.includes(OTHER_VALUE);
        return (
          <Stack gap={2}>
            {(metadata.options ?? []).map((option) => {
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
                  onClick={() => handleMultiSelectToggle(value)}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => handleMultiSelectToggle(value)}
                    id={`option-${value}`}
                    disabled={isSubmitting}
                    className="mt-0.5"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`option-${value}`}
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
            <button
              type="button"
              aria-pressed={isOtherChecked}
              className={cn(
                'flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer border-dashed',
                isOtherChecked
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30',
              )}
              onClick={() => handleMultiSelectToggle(OTHER_VALUE)}
            >
              <Checkbox
                checked={isOtherChecked}
                onCheckedChange={() => handleMultiSelectToggle(OTHER_VALUE)}
                id="option-other"
                disabled={isSubmitting}
                className="mt-0.5"
                tabIndex={-1}
                aria-hidden="true"
              />
              <div className="flex-1">
                <Label
                  htmlFor="option-other"
                  className="cursor-pointer text-sm font-medium"
                >
                  {t('otherOption')}
                </Label>
                <Description className="mt-1 text-xs">
                  {t('otherOptionDescription')}
                </Description>
              </div>
            </button>
            {isOtherChecked && (
              <Textarea
                value={otherText}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setOtherText(e.target.value)
                }
                placeholder={t('placeholder')}
                className="min-h-[80px] text-sm"
                disabled={isSubmitting}
                autoFocus
              />
            )}
          </Stack>
        );
      }

      default:
        return null;
    }
  };

  const renderResponse = () => {
    if (!metadata.response) return null;

    const { value, respondedBy, timestamp } = metadata.response;
    const displayValue = Array.isArray(value) ? value.join(', ') : value;

    return (
      <Stack gap={2} className="bg-muted/50 rounded-lg p-4">
        <Text as="div" variant="label">
          {displayValue}
        </Text>
        <Text as="div" variant="caption">
          {t('respondedByAt', {
            name: respondedBy,
            date: formatDate(new Date(timestamp), 'long'),
          })}
        </Text>
      </Stack>
    );
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-border p-5 bg-card w-full max-w-xl',
        className,
      )}
    >
      {/* Header */}
      <HStack gap={3} align="start" justify="between" className="mb-4">
        <HStack gap={3}>
          <MessageCircleQuestion className="text-primary size-5 shrink-0" />
          <div>
            <div className="text-base font-semibold">{t('questionTitle')}</div>
            <Badge variant="outline" className="mt-1 text-xs capitalize">
              {metadata.format.replace('_', ' ')}
            </Badge>
          </div>
        </HStack>
      </HStack>

      {/* Question */}
      <div className="mb-4">
        <Text className="leading-relaxed">
          {stripLeadingPunctuation(metadata.question)}
        </Text>
        {metadata.context && (
          <Text variant="caption" className="mt-2">
            {metadata.context}
          </Text>
        )}
      </div>

      {/* Input or Response */}
      {isPending ? (
        <Stack gap={4}>
          {renderInput()}

          {/* Error Message */}
          {error && (
            <HStack className="text-destructive gap-1.5 text-xs">
              <XCircle className="size-3.5" />
              {error}
            </HStack>
          )}

          {/* Submit Button */}
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isCancelling}
            className="w-full"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            {t('submit')}
          </Button>
        </Stack>
      ) : (
        renderResponse()
      )}

      {/* Footer: stop workflow link + status badge */}
      {(wfExecutionId && isPending) || !isPending ? (
        <HStack justify="end" align="center" gap={2} className="mt-2">
          {wfExecutionId && isPending && (
            <Tooltip content={t('stopWorkflowTooltip')}>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling}
                aria-busy={isCancelling}
                aria-label={t('stopWorkflow')}
                className="text-muted-foreground hover:text-destructive flex cursor-pointer items-center gap-1 text-xs transition-colors disabled:opacity-50"
              >
                {isCancelling ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Square className="size-3 fill-current" />
                )}
                {t('stopWorkflow')}
              </button>
            </Tooltip>
          )}
          {!isPending && (
            <Badge
              variant={
                status === 'completed'
                  ? 'green'
                  : status === 'executing'
                    ? 'blue'
                    : 'destructive'
              }
              className="shrink-0 text-xs capitalize"
            >
              {status === 'completed'
                ? t('statusResponded')
                : status === 'executing'
                  ? t('statusProcessing')
                  : status}
            </Badge>
          )}
        </HStack>
      ) : null}
    </div>
  );
}

export const HumanInputRequestCard = memo(
  HumanInputRequestCardComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.approvalId === nextProps.approvalId &&
      prevProps.status === nextProps.status &&
      prevProps.isWorkflowContext === nextProps.isWorkflowContext &&
      prevProps.wfExecutionId === nextProps.wfExecutionId &&
      prevProps.className === nextProps.className &&
      prevProps.onResponseSubmitted === nextProps.onResponseSubmitted
    );
  },
);
