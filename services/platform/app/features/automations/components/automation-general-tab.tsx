'use client';

import { EditorGroup } from '@tale/ui/editor';
import { PageActionHeader } from '@tale/ui/page-action-header';

import { SettingsTabPage } from '@/app/features/settings/components/settings-tab-page';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useAutomation } from '../hooks/queries';
import { ApprovalAllowancesSection } from './approval-allowances-section';
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
 * The General tab: the automation's own settings — what starts it (Trigger),
 * which projects' boards see it (Projects) and which writes it may make
 * without a person approving each run — on the general settings page, the
 * way a project's General tab carries the project's (#2794): Settings'
 * column, its section rhythm and hairlines, its row layout and its end
 * clearance. The automation's other pages are not forms and keep frames of
 * their own (see `SettingsTabPage`).
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
  const { t } = useT('automations');
  const ability = useAbility();
  // Mirrors the backend: triggers and bindings are developer-gated writes.
  const canEdit = ability.can('read', 'developerSettings');
  // The same read the page shell holds: whether a version is deployed decides
  // what the trigger section promises about the next run.
  const automationQuery = useAutomation(organizationId, automationSlug);
  return (
    <>
      {canEdit && <PageActionHeader actions={<AutomationEditorActions />} />}
      {/* Named like the open tab, as a settings page is named by its header;
          the page draws one hairline between each pair of sections and none
          after the last. */}
      <SettingsTabPage title={t('navigation.general')}>
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
          {canEdit && (
            <ApprovalAllowancesSection
              organizationId={organizationId}
              name={automationSlug}
            />
          )}
        </EditorGroup>
      </SettingsTabPage>
    </>
  );
}
