/**
 * Function references into the retired automation/agent backend, for the
 * historical migrations that still invoke it.
 *
 * The generated `internal` object no longer contains these modules (they
 * are retired), so the migrations build their references by path with
 * `makeFunctionReference` instead. The object mirrors the old `internal.*`
 * shape, so a call site changes only `internal.` → `retired.` and the
 * migration logic stays byte-identical.
 *
 * Types are deliberately loose (`any` args/return): the real contracts are
 * frozen in the replay stubs (`migrations/testing/retired_runtime.testkit.ts`,
 * one stub per function, each documenting its origin), and these migrations
 * are themselves frozen — nothing new is ever type-checked against them.
 *
 * Runtime resolution is by path string. In the migration test world the
 * stub module map resolves them; on a live deployment they only resolve
 * while the retired backend is still deployed — which is exactly the
 * supported upgrade path (deployments this old must step through a
 * pre-rewrite release before taking the rewrite).
 */

import { makeFunctionReference } from 'convex/server';

const q = (path: string) => makeFunctionReference<'query'>(path);
const m = (path: string) => makeFunctionReference<'mutation'>(path);
const a = (path: string) => makeFunctionReference<'action'>(path);

export const retired = {
  integrations: {
    credential_queries: {
      listInternal: q('integrations/credential_queries:listInternal'),
    },
  },
  workflows: {
    provision_defaults_mutations: {
      getProvision: q('workflows/provision_defaults_mutations:getProvision'),
      recordProvision: m(
        'workflows/provision_defaults_mutations:recordProvision',
      ),
      provisionDeclaredWorkflowTriggers: m(
        'workflows/provision_defaults_mutations:provisionDeclaredWorkflowTriggers',
      ),
      removeDefaultProvisioning: m(
        'workflows/provision_defaults_mutations:removeDefaultProvisioning',
      ),
    },
    provision_defaults: {
      syncDefaultWorkflowInstallations: a(
        'workflows/provision_defaults:syncDefaultWorkflowInstallations',
      ),
    },
    installations: {
      getInstallationInternal: q(
        'workflows/installations:getInstallationInternal',
      ),
      upsertInstallation: m('workflows/installations:upsertInstallation'),
    },
  },
  agents: {
    installations: {
      upsertInstallation: m('agents/installations:upsertInstallation'),
    },
  },
  automations: {
    install_mutations: {
      getAutomationInstallationInternal: q(
        'automations/install_mutations:getAutomationInstallationInternal',
      ),
      listAutomationBindingsInternal: q(
        'automations/install_mutations:listAutomationBindingsInternal',
      ),
      upsertAutomationInstallation: m(
        'automations/install_mutations:upsertAutomationInstallation',
      ),
      bindAutomationToProject: m(
        'automations/install_mutations:bindAutomationToProject',
      ),
      unbindAutomationFromProject: m(
        'automations/install_mutations:unbindAutomationFromProject',
      ),
      deleteAutomationInstallation: m(
        'automations/install_mutations:deleteAutomationInstallation',
      ),
      deleteProjectSchedules: m(
        'automations/install_mutations:deleteProjectSchedules',
      ),
      reconcileAutomationSchedules: m(
        'automations/install_mutations:reconcileAutomationSchedules',
      ),
    },
    install_actions: {
      installAutomationInternal: a(
        'automations/install_actions:installAutomationInternal',
      ),
      uninstallAutomationInternal: a(
        'automations/install_actions:uninstallAutomationInternal',
      ),
    },
  },
} as const;
