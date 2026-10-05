import { lazyComponent } from '@tale/ui/lazy-component';
import type { ComponentProps } from 'react';

import type { ProjectMetricsPage } from '../tasks/components/project-metrics-page';
import type { AutomationMetricsPage } from './automations/automation-metrics-page';
import type { ChatHealthMetricsPage } from './chat-health/chat-health-metrics-page';
import type { ExternalTurnMetricsPage } from './external-turns/external-turns-metrics-page';
import type { FeedbackMetricsPage } from './feedback/feedback-metrics-page';
import type { UsageMetricsPage } from './usage/usage-metrics-page';

// The metrics pages draw their charts with recharts (~64 KB gzip). Imported
// by their routes directly, it loaded with every page, the sign-in page's
// included (#4089); these load with their pages instead. Each route warms
// its page from its loader, so the router's hover preload fetches it with
// the page's data before the click.

export const loadUsageMetricsPage = () => import('./usage/usage-metrics-page');
export const loadAutomationMetricsPage = () =>
  import('./automations/automation-metrics-page');
export const loadFeedbackMetricsPage = () =>
  import('./feedback/feedback-metrics-page');
export const loadChatHealthMetricsPage = () =>
  import('./chat-health/chat-health-metrics-page');
export const loadExternalTurnMetricsPage = () =>
  import('./external-turns/external-turns-metrics-page');
export const loadProjectMetricsPage = () =>
  import('../tasks/components/project-metrics-page');

export const LazyUsageMetricsPage = lazyComponent<
  ComponentProps<typeof UsageMetricsPage>
>(() =>
  loadUsageMetricsPage().then((module) => ({
    default: module.UsageMetricsPage,
  })),
);
export const LazyAutomationMetricsPage = lazyComponent<
  ComponentProps<typeof AutomationMetricsPage>
>(() =>
  loadAutomationMetricsPage().then((module) => ({
    default: module.AutomationMetricsPage,
  })),
);
export const LazyFeedbackMetricsPage = lazyComponent<
  ComponentProps<typeof FeedbackMetricsPage>
>(() =>
  loadFeedbackMetricsPage().then((module) => ({
    default: module.FeedbackMetricsPage,
  })),
);
export const LazyChatHealthMetricsPage = lazyComponent<
  ComponentProps<typeof ChatHealthMetricsPage>
>(() =>
  loadChatHealthMetricsPage().then((module) => ({
    default: module.ChatHealthMetricsPage,
  })),
);
export const LazyExternalTurnMetricsPage = lazyComponent<
  ComponentProps<typeof ExternalTurnMetricsPage>
>(() =>
  loadExternalTurnMetricsPage().then((module) => ({
    default: module.ExternalTurnMetricsPage,
  })),
);
export const LazyProjectMetricsPage = lazyComponent<
  ComponentProps<typeof ProjectMetricsPage>
>(() =>
  loadProjectMetricsPage().then((module) => ({
    default: module.ProjectMetricsPage,
  })),
);
