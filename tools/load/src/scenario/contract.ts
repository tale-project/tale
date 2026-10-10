/**
 * The seam between the runner (how many virtual users run, when, where) and
 * the scenario (what one virtual user does). The runner never knows what a
 * journey is; the scenario never knows how many users there are.
 */

import type { Agent } from 'undici';
import { z } from 'zod';

import type { MetricsRegistry } from '../metrics/index.ts';
import type { LoadPlan } from '../plan.ts';

/**
 * The kinds of people a run simulates. Each persona is a weighted mix of
 * journeys with its own think times; the runner assigns personas by weight,
 * deterministically from the user index, so a rerun with the same plan and
 * weights drives the same people the same way.
 */
export const PERSONA_NAMES = [
  /** App open, mostly reading: Home, threads, notifications; rare writes. */
  'browser',
  /** The chat-heavy user: multi-turn conversations, attachments, renames. */
  'chatter',
  /** Lives on the task board: creates, moves, comments, assigns. */
  'task-worker',
  /** Uploads documents and searches the knowledge base. */
  'knowledge',
  /** Owner/admin chores: members, teams, API keys, audit, settings. */
  'admin',
  /** A machine client on the REST API with an API key. */
  'api-client',
  /** Sends malformed and hostile input on purpose (expects 4xx, never 5xx). */
  'fuzzer',
] as const;

export type PersonaName = (typeof PERSONA_NAMES)[number];

/** Weights by persona; a persona left out has weight 0. */
export const personaWeightsSchema = z
  .partialRecord(z.enum(PERSONA_NAMES), z.number().min(0))
  .refine((weights) => Object.values(weights).some((w) => w > 0), {
    message: 'at least one persona needs a positive weight',
  });

export type PersonaWeights = z.infer<typeof personaWeightsSchema>;

/** The default population mix: mostly people reading and chatting. */
export const DEFAULT_PERSONA_WEIGHTS: PersonaWeights = {
  browser: 40,
  chatter: 30,
  'task-worker': 15,
  knowledge: 6,
  admin: 3,
  'api-client': 4,
  fuzzer: 2,
};

/** What a run lets virtual users do; every switch defaults to on. */
export const scenarioOptionsSchema = z.object({
  /** Multiplies every think time: 1 = human pace, 0.1 = ten times faster. */
  thinkTimeScale: z.number().min(0).default(1),
  /** Hold the `/events` hint stream open like a browser tab does. */
  realtime: z.boolean().default(true),
  /** Hold the per-thread chat stream open while a thread is on screen. */
  threadStreams: z.boolean().default(true),
  /** Send chat turns (each one reaches the model provider). */
  chat: z.boolean().default(true),
  /** Upload documents (needs object storage on the target). */
  uploads: z.boolean().default(true),
  /** Search the knowledge base (needs an embedding model). */
  knowledgeSearch: z.boolean().default(true),
  /** Sign in with the password instead of adopting a minted session, for
   * this share of sessions (0..1). Sign-in is rate limited per client IP. */
  passwordSignInRate: z.number().min(0).max(1).default(0.02),
  /** Share of chat messages carrying a mock-provider fault directive. */
  providerFaultRate: z.number().min(0).max(1).default(0),
  /** Mean session length before the user "closes the tab" and a fresh
   * session of the same user starts (seconds). 0 = never. */
  sessionSeconds: z.number().min(0).default(1_200),
  /** Hard cap on one request's wait (ms). */
  requestTimeoutMs: z.number().int().min(1_000).default(30_000),
  /** Cap on one chat turn's wait from send to settle (ms). */
  turnTimeoutMs: z.number().int().min(1_000).default(180_000),
});

export type ScenarioOptions = z.infer<typeof scenarioOptionsSchema>;

/** Everything one virtual user needs; built by the runner per user. */
export interface VirtualUserContext {
  /** The user's index in the plan (identity: e-mail, org, token). */
  readonly index: number;
  readonly plan: LoadPlan;
  /** The base URL this user talks to (the runner may spread users across
   * several entry points of one deployment). */
  readonly baseUrl: string;
  /** The process's shared HTTP agent. */
  readonly agent: Agent;
  /** The process's shared metrics registry. */
  readonly metrics: MetricsRegistry;
  /** The deployment's auth secret, when the plan minted sessions. */
  readonly authSecret: string | null;
  readonly persona: PersonaName;
  /** Seeded from the user index: same user, same choices. */
  readonly random: () => number;
  readonly options: ScenarioOptions;
  /** Aborted when the runner wants this user gone (ramp-down, end of run). */
  readonly signal: AbortSignal;
  /** Synthetic client address this user sends as X-Forwarded-For, when the
   * target trusts the generator as a proxy; null otherwise. */
  readonly forwardedFor: string | null;
}

/**
 * Run one virtual user until its signal aborts. Never throws: every failure
 * is recorded in the metrics and the user carries on (or backs off) the way
 * a person retrying would. Resolves once the user's connections are closed.
 */
export type RunVirtualUser = (context: VirtualUserContext) => Promise<void>;
