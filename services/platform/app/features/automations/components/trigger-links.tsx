'use client';

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { automationSlugToParam } from '@/lib/automations/slug';

/** The design system's inline text link. */
const TRIGGER_LINK_CLASS =
  'text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none';

/** Where the trigger section is shown: under a project when the tab is. */
export interface TriggerPlace {
  organizationId: string;
  projectId: string | undefined;
  name: string;
}

/** A run's page, opened where the section is shown — under the project when
 * the tab is, as the run list's rows open it. */
export function TriggerRunLink({
  place,
  runId,
  children,
}: {
  place: TriggerPlace;
  runId: string;
  children: ReactNode;
}) {
  const automationSlug = automationSlugToParam(place.name);
  return (
    <Link
      {...(place.projectId
        ? {
            to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId' as const,
            params: {
              id: place.organizationId,
              projectId: place.projectId,
              automationSlug,
              runId,
            },
          }
        : {
            to: '/dashboard/$id/automations/$automationSlug/runs/$runId' as const,
            params: { id: place.organizationId, automationSlug, runId },
          })}
      className={TRIGGER_LINK_CLASS}
    >
      {children}
    </Link>
  );
}

/** The automation's editor, where a version is fixed and deployed. */
export function TriggerEditorLink({
  place,
  children,
}: {
  place: TriggerPlace;
  children: ReactNode;
}) {
  const automationSlug = automationSlugToParam(place.name);
  return (
    <Link
      {...(place.projectId
        ? {
            to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor' as const,
            params: {
              id: place.organizationId,
              projectId: place.projectId,
              automationSlug,
            },
          }
        : {
            to: '/dashboard/$id/automations/$automationSlug/editor' as const,
            params: { id: place.organizationId, automationSlug },
          })}
      className={TRIGGER_LINK_CLASS}
    >
      {children}
    </Link>
  );
}
