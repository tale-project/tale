import { defineApp } from 'convex/server';
import betterAuth from './betterAuth/convex.config';
import workflow from '@convex-dev/workflow/convex.config';
import agent from '@convex-dev/agent/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import actionCache from '@convex-dev/action-cache/convex.config';

const app = defineApp();
app.use(betterAuth);
app.use(workflow);
app.use(agent);
app.use(rateLimiter);
app.use(actionCache);

export default app;
