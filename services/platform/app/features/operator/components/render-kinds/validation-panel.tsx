'use client';

/** `validation` — machine pass/warn/fail checks. Reads a `checks[]` array of
 * `{ label?, status, observed?, expected? }` (or a pass/fail count summary) and
 * embeds a small sample of failing rows. */
import { Badge } from '@tale/ui/badge';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import {
  asRecord,
  pickArray,
  pickString,
  scalar,
} from '../../lib/output-helpers';
import type { StepProjection } from '../../types';
import { OutputFallback } from '../output-fallback';

type CheckStatus = 'pass' | 'warn' | 'fail';
const BADGE: Record<CheckStatus, 'green' | 'yellow' | 'destructive'> = {
  pass: 'green',
  warn: 'yellow',
  fail: 'destructive',
};

function normalizeStatus(value: string | undefined): CheckStatus {
  if (value === 'fail' || value === 'failed' || value === 'error')
    return 'fail';
  if (value === 'warn' || value === 'warning') return 'warn';
  return 'pass';
}

export function ValidationPanel({ step }: { step: StepProjection }) {
  const { t } = useT('operator');
  const out = asRecord(step.output);
  const checks = pickArray(out, 'checks', 'validations', 'results');

  if (checks.length === 0) return <OutputFallback step={step} />;

  return (
    <VStack gap={2}>
      {checks.slice(0, 50).map((raw, i) => {
        const check = asRecord(raw);
        const status = normalizeStatus(pickString(check, 'status', 'result'));
        const label =
          pickString(check, 'label', 'name', 'check') ??
          `${t('field.check')} ${i + 1}`;
        const observed = check?.observed;
        const expected = check?.expected;
        return (
          <HStack
            key={`${label}-${i}`}
            gap={2}
            className="items-center justify-between"
          >
            <Text as="span" truncate>
              {label}
            </Text>
            <HStack gap={2} className="items-center">
              {(observed !== undefined || expected !== undefined) && (
                <Text as="span" variant="muted">
                  {scalar(observed)} / {scalar(expected)}
                </Text>
              )}
              <Badge variant={BADGE[status]}>{t(`check.${status}`)}</Badge>
            </HStack>
          </HStack>
        );
      })}
    </VStack>
  );
}
