import actionCache from '@convex-dev/action-cache/convex.config';
import agent from '@convex-dev/agent/convex.config';
import persistentTextStreaming from '@convex-dev/persistent-text-streaming/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import workflow from '@convex-dev/workflow/convex.config';
import { defineApp } from 'convex/server';

import betterAuth from './betterAuth/convex.config';

const app = defineApp();
app.use(betterAuth);
app.use(workflow);
app.use(workflow, { name: 'workflow_1' });
app.use(workflow, { name: 'workflow_2' });
app.use(workflow, { name: 'workflow_3' });
app.use(agent);
app.use(rateLimiter);
app.use(actionCache);
app.use(persistentTextStreaming);

export default app;
