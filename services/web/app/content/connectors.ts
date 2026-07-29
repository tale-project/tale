/**
 * Connector / provider logos for the homepage marquee. Brand names stay
 * English; the section title/subtitle are localized under `home.connectors`.
 */

import { GithubIcon } from '@tale/ui/icons/github';

import { AtlassianIcon } from '@/app/components/icons/atlassian-icon';
import {
  ClaudeIcon,
  DiscordIcon,
  GmailIcon,
  OpenAIIcon,
  ShopifyIcon,
  SlackIcon,
  TavilyIcon,
} from '@/app/components/icons/connector-icons';
import { CursorIcon } from '@/app/components/icons/cursor-icon';
import { GeminiIcon } from '@/app/components/icons/gemini-icon';
import { GoogleIcon } from '@/app/components/icons/google-icon';
import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import type { BrandIcon } from '@/app/components/icons/types';

export interface ConnectorLogo {
  Icon: BrandIcon;
  name: string;
  /**
   * Optional `companies.*` key in `global.json`. When set, the tooltip
   * shows the full legal company name instead of the short brand label —
   * used for parent companies whose product portfolio isn't obvious from
   * the logo alone (Microsoft, Google, Atlassian).
   */
  companyKey?: 'microsoft' | 'google' | 'atlassian';
}

export const INTEGRATION_LOGOS: readonly ConnectorLogo[] = [
  { Icon: OpenAIIcon, name: 'OpenAI' },
  { Icon: ShopifyIcon, name: 'Shopify' },
  { Icon: ClaudeIcon, name: 'Claude' },
  { Icon: CursorIcon, name: 'Cursor' },
  { Icon: GeminiIcon, name: 'Gemini' },
  { Icon: GithubIcon, name: 'GitHub' },
  { Icon: MicrosoftIcon, name: 'Microsoft', companyKey: 'microsoft' },
  { Icon: GoogleIcon, name: 'Google', companyKey: 'google' },
  { Icon: AtlassianIcon, name: 'Atlassian', companyKey: 'atlassian' },
  { Icon: SlackIcon, name: 'Slack' },
  { Icon: DiscordIcon, name: 'Discord' },
  { Icon: GmailIcon, name: 'Gmail' },
  { Icon: TavilyIcon, name: 'Tavily' },
];
