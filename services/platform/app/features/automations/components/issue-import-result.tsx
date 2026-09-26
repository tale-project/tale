'use client';

import { Alert } from '@tale/ui/alert';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';

import { useT } from '@/lib/i18n/client';

import { issueImportResultSchema, issueSource } from '../lib/issue-import';

export function IssueImportResult({
  organizationId,
  automationSlug,
  output,
  mock,
}: {
  organizationId: string;
  automationSlug: string;
  output: unknown;
  mock: boolean;
}) {
  const { t } = useT('automations');
  if (issueSource(automationSlug) === null) return null;
  const parsed = issueImportResultSchema.safeParse(output);
  if (!parsed.success) return null;
  const result = parsed.data;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader as="h3" title={t('issueImport.resultTitle')} />
      <Text as="p">
        {t('issueImport.summary', {
          imported: result.imported,
          created: result.created,
          updated: result.updated,
        })}
      </Text>
      {mock ? (
        <Alert variant="info" description={t('issueImport.mockResult')} />
      ) : (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {result.tasks.map((task) => (
            <li key={task.taskId}>
              <Link
                to="/dashboard/$id/tasks/$taskId"
                params={{ id: organizationId, taskId: task.taskId }}
                className="text-primary rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {task.title ?? t('issueImport.openTask', { id: task.taskId })}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {Boolean(result.skipped) && (
        <Alert
          variant="info"
          description={t('issueImport.skipped', { count: result.skipped ?? 0 })}
        />
      )}
      {result.refreshHasMore && (
        <Alert variant="info" description={t('issueImport.refreshHasMore')} />
      )}
      {result.truncated && (
        <Alert variant="warning" description={t('issueImport.truncated')} />
      )}
    </section>
  );
}
