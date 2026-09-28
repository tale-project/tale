'use client';

import { ContentArea } from '@tale/ui/content-area';
import { EditorGroup } from '@tale/ui/editor';
import { PageActionHeader } from '@tale/ui/page-action-header';

import { SECTION_DIVIDER_CLASS } from '@/app/features/settings/components/settings-page';
import { useAbility } from '@/app/hooks/use-ability';

import { useAutomation } from '../hooks/queries';
import { AutomationEditorActions } from './automation-editor-actions';
import { ProjectBindingsSection } from './project-bindings-section';
import { TriggerEditor } from './trigger-editor';

interface AutomationGeneralTabProps {
  organizationId: string;
  automationSlug: string;
  /** Set on the project's route: what the tab links opens under it. */
  projectId?: string | undefined;
}

/**
 * The General tab: the automation's own settings — what starts it (Trigger)
 * and which projects' boards see it (Projects) — on the settings measure,
 * the way a project's General tab carries the project's.
 *
 * The sections are independent stores, but the page has ONE Save/Discard
 * cluster, in the tab strip where every tabbed page keeps it: `EditorGroup`
 * composes the sections' controllers, and Save writes whichever are dirty.
 * Members see the settings read-only and no cluster at all.
 */
export function AutomationGeneralTab(props: AutomationGeneralTabProps) {
  // Route parameters change without unmounting the page (a switch to a
  // sibling keeps this tab); a new automation starts from its own stored
  // settings, never another one's unsaved edits.
  return (
    <AutomationGeneralScope
      key={JSON.stringify([props.organizationId, props.automationSlug])}
      {...props}
    />
  );
}

function AutomationGeneralScope({
  organizationId,
  automationSlug,
  projectId,
}: AutomationGeneralTabProps) {
  const ability = useAbility();
  // Mirrors the backend: triggers and bindings are developer-gated writes.
  const canEdit = ability.can('read', 'developerSettings');
  // The same read the page shell holds: whether a version is deployed decides
  // what the trigger section promises about the next run.
  const automationQuery = useAutomation(organizationId, automationSlug);
  return (
    <>
      {canEdit && <PageActionHeader actions={<AutomationEditorActions />} />}
      {/* The section divider keys on each section's marker, drawing one
          hairline between Trigger and Projects and none after the last. */}
      <ContentArea variant="narrow" gap={6} className={SECTION_DIVIDER_CLASS}>
        <EditorGroup>
          <TriggerEditor
            organizationId={organizationId}
            name={automationSlug}
            canEdit={canEdit}
            deployedVersion={automationQuery.data?.deployedVersion}
            projectId={projectId}
          />
          <ProjectBindingsSection
            organizationId={organizationId}
            name={automationSlug}
            canEdit={canEdit}
          />
        </EditorGroup>
      </ContentArea>
    </>
  );
}
