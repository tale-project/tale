'use client';

import { useTranslation } from 'react-i18next';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import type { ArenaVerdict } from './types';

interface ArenaSummaryProps {
  byVerdict: Record<ArenaVerdict, number>;
  total: number;
}

const VERDICT_ORDER: ArenaVerdict[] = [
  'a_better',
  'b_better',
  'tie',
  'both_bad',
];

const VERDICT_I18N_KEY: Record<ArenaVerdict, string> = {
  a_better: 'aBetter',
  b_better: 'bBetter',
  tie: 'tie',
  both_bad: 'bothBad',
};

export function ArenaSummary({ byVerdict, total }: ArenaSummaryProps) {
  const { t: tAnalytics } = useT('analytics');
  const { t: tChat } = useT('chat');
  const { i18n } = useTranslation();

  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <Text as="h3" className="text-foreground text-base font-semibold">
        {tAnalytics('feedback.arena.title')}
      </Text>
      <div className="border-border grid grid-cols-2 overflow-hidden rounded-lg border md:grid-cols-4">
        {VERDICT_ORDER.map((verdict, idx) => (
          <div
            key={verdict}
            className={
              'flex flex-col gap-1 px-5 py-6 ' +
              (idx === VERDICT_ORDER.length - 1
                ? ''
                : 'border-border border-b md:border-r md:border-b-0')
            }
          >
            <Text className="text-muted-foreground text-sm">
              {tChat(`arena.${VERDICT_I18N_KEY[verdict]}`)}
            </Text>
            <Text className="text-foreground font-mono text-2xl font-semibold">
              {formatNumber(byVerdict[verdict] ?? 0, i18n.language)}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}
