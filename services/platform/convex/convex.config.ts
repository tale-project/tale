import actionCache from '@convex-dev/action-cache/convex.config';
import agent from '@convex-dev/agent/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import workflow from '@convex-dev/workflow/convex.config';
import workpool from '@convex-dev/workpool/convex.config';
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

// File indexing runs a synchronous extract/chunk/embed inside a Node action
// against the org's knowledge-db pool, whose size is `KNOWLEDGE_DB_POOL_MAX`
// (default 10). These two pools bound how many such actions run at once, so
// the connection budget is never saturated and RAG search keeps headroom.
//
// TWO pools, not one, because the budget was undifferentiated: a connector
// minting one queued row every 5 minutes held the single cap of 3 and no user
// upload indexed for 7 days (#2987, seen on a live deployment). Interactive
// work now has a budget a background backlog cannot occupy.
//
// Raising `KNOWLEDGE_DB_POOL_MAX` without revisiting these numbers leaves the
// pools as the binding constraint — the two settings are related.
app.use(workpool, { name: 'ragInteractivePool' });
app.use(workpool, { name: 'ragBackgroundPool' });

export default app;
