'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { useProjects } from '@/app/features/projects/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useStartAutomationRun } from '../hooks/mutations';
import { automationErrorMessage } from '../lib/errors';
import { AutomationRunDialog } from './automation-run-dialog';

export function IssueImportContinuation({
  organizationId,
  projectId,
  automationSlug,
  version,
  mode,
  input,
  schema,
  cursor,
}: {
  organizationId: string;
  projectId?: string;
  automationSlug: string;
  version: number;
  mode: 'mock' | 'live';
  input: unknown;
  schema: Record<string, unknown>;
  cursor: string;
}) {
  const { t } = useT('automations');
  const { projects } = useProjects(organizationId);
  const ability = useAbility();
  const start = useStartAutomationRun();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = z.record(z.string(), z.unknown()).safeParse(input);
  if (
    !parsed.success ||
    (mode === 'live' && !ability.can('read', 'developerSettings'))
  )
    return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('issueImport.continue')}
      </Button>
      {open && (
        <AutomationRunDialog
          request={{
            automationSlug,
            projectId,
            version,
            mode,
            schema,
            initialInput: { ...parsed.data, cursor },
            scopeText: '',
          }}
          projects={projects}
          pending={start.isPending}
          error={error}
          onClose={() => {
            setOpen(false);
            setError(null);
          }}
          onConfirm={(nextInput) => {
            setError(null);
            start.mutate(
              {
                organizationId,
                projectId,
                name: automationSlug,
                mode,
                version,
                input: nextInput,
              },
              {
                onError: (failure) => setError(automationErrorMessage(failure)),
                onSuccess: (result) => {
                  setOpen(false);
                  void navigate({
                    to: '/dashboard/$id/automations/$automationSlug/runs/$runId',
                    params: {
                      id: organizationId,
                      automationSlug,
                      runId: result.runId,
                    },
                  });
                },
              },
            );
          }}
        />
      )}
    </>
  );
}
