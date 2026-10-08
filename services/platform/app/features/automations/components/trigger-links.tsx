'use client';

import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { automationSlugToParam } from '@/lib/automations/slug';

import { AUTOMATION_TRIGGER_SECTION_ID } from '../lib/field-ids';

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

/** The trigger section of the automation's General tab, as an action:
 * where a trigger is looked over before it is turned on. */
export function TriggerSectionLink({
  place,
  onNavigate,
  children,
}: {
  place: TriggerPlace;
  /** Runs as the link is followed — a dialog closes itself. */
  onNavigate?: (() => void) | undefined;
  children: ReactNode;
}) {
  const automationSlug = automationSlugToParam(place.name);
  return (
    <Button asChild size="sm" variant="secondary">
      <Link
        {...(place.projectId
          ? {
              to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/general' as const,
              params: {
                id: place.organizationId,
                projectId: place.projectId,
                automationSlug,
              },
            }
          : {
              to: '/dashboard/$id/automations/$automationSlug/general' as const,
              params: { id: place.organizationId, automationSlug },
            })}
        hash={AUTOMATION_TRIGGER_SECTION_ID}
        onClick={onNavigate}
      >
        {children}
      </Link>
    </Button>
  );
}
