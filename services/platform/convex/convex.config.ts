import { defineApp } from 'convex/server';
import betterAuth from './betterAuth/convex.config';
import workflow from '@convex-dev/workflow/convex.config';
import agent from '@convex-dev/agent/convex.config';
import actionRetrier from '@convex-dev/action-retrier/convex.config';

const app = defineApp();
app.use(betterAuth);
app.use(workflow);
app.use(agent);
app.use(actionRetrier);

export default app;
