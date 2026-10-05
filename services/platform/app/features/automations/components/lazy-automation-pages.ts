import { lazyComponent } from '@tale/ui/lazy-component';
import type { ComponentProps } from 'react';

import type { AutomationEditor } from './automation-editor';
import type { RunDetail } from './run-detail';

// The automation editor and a run's detail draw their graph on the flow
// canvas (React Flow, its d3 modules and the ELK layout). Imported by their
// routes directly, that canvas loaded with every page, the sign-in page's
// included (#4089); these load with their pages instead. A route warms its
// chunk from its loader, so the router's hover preload fetches it before
// the click.

export const loadAutomationEditor = () => import('./automation-editor');
export const loadRunDetail = () => import('./run-detail');

export const LazyAutomationEditor = lazyComponent<
  ComponentProps<typeof AutomationEditor>
>(() =>
  loadAutomationEditor().then((module) => ({
    default: module.AutomationEditor,
  })),
);

export const LazyRunDetail = lazyComponent<ComponentProps<typeof RunDetail>>(
  () => loadRunDetail().then((module) => ({ default: module.RunDetail })),
);
