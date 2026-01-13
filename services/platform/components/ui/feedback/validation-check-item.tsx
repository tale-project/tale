'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { HStack } from '@/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

export interface ValidationCheckItemProps {
  /** Whether the validation check passes */
  isValid: boolean;
  /** The validation message to display */
  message: string;
  /** Additional className for the container */
  className?: string;
}

/**
 * A single validation check item that displays a check/X icon with a message.
 * Used for password requirements, form validation lists, etc.
 */
export const ValidationCheckItem = React.memo(function ValidationCheckItem({
  isValid,
  message,
  className,
}: ValidationCheckItemProps) {
  const { t } = useT('common');
  const Icon = isValid ? Check : X;
  const status = isValid ? t('aria.valid') : t('aria.invalid');

  return (
    <HStack
      gap={2}
      align="center"
      className={cn('text-sm', className)}
      role="listitem"
      aria-label={t('aria.validationStatus', { message, status })}
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          isValid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
        )}
        aria-hidden="true"
      />
      <span className={isValid ? 'text-muted-foreground' : 'text-foreground'}>
        {message}
      </span>
    </HStack>
  );
});

export interface ValidationCheckListProps {
  /** Array of validation items */
  items: Array<{
    isValid: boolean;
    message: string;
  }>;
  /** Additional className for the list container */
  className?: string;
}

/**
 * A list of validation check items.
 * Provides proper list semantics for accessibility.
 */
export const ValidationCheckList = React.memo(function ValidationCheckList({
  items,
  className,
}: ValidationCheckListProps) {
  const { t } = useT('common');
  return (
    <ul
      className={cn('space-y-1', className)}
      role="list"
      aria-label={t('aria.validationRequirements')}
    >
      {items.map((item, index) => (
        <li key={index}>
          <ValidationCheckItem isValid={item.isValid} message={item.message} />
        </li>
      ))}
    </ul>
  );
});
