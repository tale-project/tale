import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { httpAction } from './_generated/server';

const http = httpRouter();

// Simple health check to verify HTTP actions are enabled
http.route({
  path: '/ping',
  method: 'GET',
  handler: httpAction(async () => new Response('ok', { status: 200 })),
});

// Register Better Auth HTTP routes; no CORS needed for Next.js rewrites
// This automatically registers endpoints like /api/auth/get-session
authComponent.registerRoutes(http, createAuth);

const routes = http.getRoutes();
export default http;
