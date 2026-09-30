'use client';

import { useMemo } from 'react';

import {
  useProjectCapabilityCatalog,
  useProjectHarnesses,
} from '../hooks/queries';
import { toModelOptions } from '../lib/model-options';
import { ProjectAgentDialog } from './project-agent-dialog';

/**
 * "New agent" as a dialog any surface can open in place — the task dialog's
 * assignee picker, for a project that has no agent yet. It loads what the
 * form offers (the runtimes and models the organization can serve, the
 * skills and connectors the project can equip) by itself, so the caller
 * needs nothing but the project. Mount it only while it is open: its reads
 * belong to the form, not to the surface that offers the door.
 */
export function ProjectAgentCreateDialog({
  organizationId,
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent was created — before the dialog closes. */
  onCreated?: (agentId: string) => void;
}) {
  const rosterQuery = useProjectHarnesses(organizationId);
  const catalogQuery = useProjectCapabilityCatalog(organizationId, projectId);
  const modelRows = rosterQuery.data?.models;
  const models = useMemo(() => toModelOptions(modelRows ?? []), [modelRows]);

  return (
    <ProjectAgentDialog
      open={open}
      onOpenChange={onOpenChange}
      projectId={projectId}
      organizationId={organizationId}
      harnesses={rosterQuery.data?.harnesses ?? []}
      models={models}
      skills={catalogQuery.data?.skills}
      connectors={catalogQuery.data?.connectors ?? []}
      {...(onCreated !== undefined ? { onCreated } : {})}
    />
  );
}
