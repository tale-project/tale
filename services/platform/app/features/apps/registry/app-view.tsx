'use client';

/**
 * Renders one app view — a Puck Data document — through the Tale registry,
 * inside the runtime context that the connected blocks read (org + the app's
 * function allowlist). Headless `<Render>`: no editor, just the composed UI.
 */
import { type Data, Render } from '@measured/puck';

import type { FunctionBinding } from '@/lib/shared/platform/function_bindings';

import { AppRuntimeProvider } from '../runtime/app-runtime';
import { taleConfig } from './tale-config';

export function AppView({
  organizationId,
  appSlug,
  allowlist,
  data,
}: {
  organizationId: string;
  appSlug: string;
  allowlist: FunctionBinding[];
  data: unknown;
}) {
  return (
    <AppRuntimeProvider value={{ organizationId, appSlug, allowlist }}>
      {/* The view is a Puck Data document read from the app bundle; Puck's
          Render tolerates shape at runtime. Its Data type is too structural to
          hand-guard, so assert at this single JSON boundary. */}
      {/* oxlint-disable-next-line typescript/no-unsafe-type-assertion */}
      <Render config={taleConfig} data={data as Data} />
    </AppRuntimeProvider>
  );
}
