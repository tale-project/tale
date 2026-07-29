/**
 * External agents Tale orchestrates — same roster as
 * docs/en/platform/agents/external-agent.md. Brand names stay English
 * (product marks); the section title/subtitle are localized.
 */

import {
  HermesIcon,
  OpenClawIcon,
  OpenCodeIcon,
  PiAgentIcon,
} from '@/app/components/icons/agent-icons';
import { ClaudeIcon, OpenAIIcon } from '@/app/components/icons/connector-icons';
import { CursorIcon } from '@/app/components/icons/cursor-icon';
import { GeminiIcon } from '@/app/components/icons/gemini-icon';
import type { BrandIcon } from '@/app/components/icons/types';

interface AgentEntry {
  id: string;
  /** Unlocalized product mark — matches the shipped agent name. */
  name: string;
  Icon: BrandIcon;
  /** Wider wordmark tiles need a different aspect. */
  wide?: boolean;
}

export const AGENTS: readonly AgentEntry[] = [
  { id: 'claude', name: 'Claude', Icon: ClaudeIcon },
  { id: 'codex', name: 'Codex', Icon: OpenAIIcon },
  { id: 'gemini', name: 'Gemini', Icon: GeminiIcon },
  { id: 'cursor', name: 'Cursor', Icon: CursorIcon },
  { id: 'hermes', name: 'Hermes', Icon: HermesIcon },
  { id: 'openclaw', name: 'OpenClaw', Icon: OpenClawIcon },
  { id: 'pi', name: 'Pi', Icon: PiAgentIcon },
  { id: 'opencode', name: 'OpenCode', Icon: OpenCodeIcon },
];
