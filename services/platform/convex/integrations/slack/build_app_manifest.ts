/**
 * Build a Slack App Manifest for the per-org "bring your own app" setup flow.
 *
 * Each org creates its own Slack app from this manifest (api.slack.com/apps →
 * Create New App → From a manifest), which pre-fills the bot scopes, the
 * Events API Request URL, the inbound bot events, and the OAuth redirect URL —
 * so the admin only has to copy the resulting Client ID / Client Secret /
 * Signing Secret back into the integration settings.
 *
 * Pure (no ctx / no env reads): callers pass the resolved URLs and scopes.
 */

/** Inbound bot events the events handler answers (see `parseEvent`). */
export const SLACK_BOT_EVENTS = ['app_mention', 'message.im'] as const;

export interface SlackManifestInput {
  /** Bot scopes — the integration's `oauth2Config.scopes` from its file config. */
  scopes: string[];
  /** Events API Request URL (`/api/integrations/slack/events`). */
  eventsUrl: string;
  /** OAuth2 redirect URL (`/api/integrations/oauth2/callback`). */
  redirectUrl: string;
  /** Display name for the Slack app + bot user. */
  appName?: string;
}

export function buildSlackAppManifest(input: SlackManifestInput): unknown {
  const appName = input.appName ?? 'Tale';
  return {
    display_information: { name: appName },
    features: {
      bot_user: { display_name: appName, always_online: true },
    },
    oauth_config: {
      redirect_urls: [input.redirectUrl],
      scopes: { bot: input.scopes },
    },
    settings: {
      event_subscriptions: {
        request_url: input.eventsUrl,
        bot_events: [...SLACK_BOT_EVENTS],
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/** Pretty-printed JSON manifest ready to paste into Slack's "From a manifest". */
export function buildSlackAppManifestJson(input: SlackManifestInput): string {
  return JSON.stringify(buildSlackAppManifest(input), null, 2);
}
