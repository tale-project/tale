import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { InlineCode } from '@tale/ui/inline-code';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { SUMMARY_FOCUS_CLASS } from '@/app/lib/summary-focus';
import { useT } from '@/lib/i18n/client';

import { TOOL_GROUPS, type ToolGroupKey } from '../lib/tools';

/**
 * The tools an assistant gets, a group to a row: its name and how many tools it
 * holds, and on opening, what the group is for and the tools by name. Closed,
 * five rows say what an assistant can touch; the names are there for whoever
 * wants to see them.
 */
export function ToolGroups() {
  const { t } = useT('settings');
  const words = useMemo(() => {
    const groups: Record<ToolGroupKey, { title: string; description: string }> =
      {
        overview: {
          title: t('aiAccess.tools.overview.title'),
          description: t('aiAccess.tools.overview.description'),
        },
        sessions: {
          title: t('aiAccess.tools.sessions.title'),
          description: t('aiAccess.tools.sessions.description'),
        },
        proxies: {
          title: t('aiAccess.tools.proxies.title'),
          description: t('aiAccess.tools.proxies.description'),
        },
        browser: {
          title: t('aiAccess.tools.browser.title'),
          description: t('aiAccess.tools.browser.description'),
        },
        secrets: {
          title: t('aiAccess.tools.secrets.title'),
          description: t('aiAccess.tools.secrets.description'),
        },
      };
    return groups;
  }, [t]);

  return (
    <Card padding="none" className="divide-border divide-y overflow-hidden">
      {TOOL_GROUPS.map((group) => (
        <CollapsibleDetails
          key={group.key}
          // The padding is the summary's, not the row's: the whole row is the
          // control, and a click in its padding toggles it. `CollapsibleDetails`
          // has no prop for the summary's classes yet (as its `IssueDetail`
          // does, reached by selector).
          className={cn(
            '[&>summary]:px-4 [&>summary]:py-3',
            SUMMARY_FOCUS_CLASS,
          )}
          summary={
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <span className="min-w-0">{words[group.key].title}</span>
              <Text
                as="span"
                variant="caption"
                className="shrink-0 font-normal"
              >
                {t('aiAccess.tools.count', { count: group.tools.length })}
              </Text>
            </span>
          }
        >
          <div className="flex flex-col gap-3 px-4 pt-1 pb-3 pl-9">
            <Text variant="muted">{words[group.key].description}</Text>
            <ul role="list" className="flex flex-wrap gap-1.5">
              {group.tools.map((tool) => (
                <li key={tool}>
                  <InlineCode>{tool}</InlineCode>
                </li>
              ))}
            </ul>
          </div>
        </CollapsibleDetails>
      ))}
    </Card>
  );
}
