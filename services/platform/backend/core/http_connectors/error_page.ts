/**
 * The page a user sees when connecting a connector fails.
 *
 * Everything on it is a FIXED string chosen from the enum below. Nothing from
 * the vendor's response, the request, or an exception message is rendered:
 * a token-exchange failure body routinely echoes the code, the client id, and
 * sometimes the token itself, and an error page is the easiest place in an
 * OAuth flow to leak one. The operator's detail goes to the server log; the
 * browser gets a sentence and a way back.
 *
 * The markup carries no script and no external reference, and says so in its
 * Content-Security-Policy, so the page cannot be turned into an injection
 * surface by anything upstream of it.
 */

import { basePath } from '../lib/helpers/public_origin.ts';

export type ConnectorErrorKind =
  /** State missing, unknown, replayed or expired — deliberately one message. */
  | 'invalid_state'
  /** The user declined consent, or the vendor refused the authorization code. */
  | 'vendor_declined'
  /** The vendor's token endpoint could not be reached or answered nonsense. */
  | 'vendor_unreachable'
  /** This deployment has no OAuth app configured for the connector. */
  | 'not_configured'
  /** The slug is not a shipped connector, or it offers no OAuth2 method. */
  | 'unsupported_connector'
  /** The Slack workspace is already connected to a different organization. */
  | 'workspace_claimed'
  /** Tokens were obtained but could not be stored. */
  | 'storage_failed'
  /** The credential a Reconnect named is gone, or no OAuth grant of this
   * connector in this organization. */
  | 'credential_missing'
  /** A Reconnect was consented in another workspace than its credential's. */
  | 'account_mismatch'
  /** The member may no longer write this organization's credentials. */
  | 'forbidden';

interface ErrorCopy {
  readonly title: string;
  readonly detail: string;
  readonly status: number;
}

const ERROR_COPY: Record<ConnectorErrorKind, ErrorCopy> = {
  invalid_state: {
    title: 'This connection link has expired',
    detail:
      'Connection links can only be used once, and expire after a few minutes. Start the connection again from your connector settings.',
    status: 400,
  },
  vendor_declined: {
    title: 'The provider declined the connection',
    detail:
      'No access was granted, so nothing was saved. This usually means consent was cancelled or took too long. Try connecting again.',
    status: 400,
  },
  vendor_unreachable: {
    title: 'The provider could not be reached',
    detail:
      'The connection could not be completed because the provider did not answer. Nothing was saved. Try again in a few minutes.',
    status: 502,
  },
  not_configured: {
    title: 'This connector has no OAuth app yet',
    detail:
      'An organization admin can configure one under Settings > Connectors > OAuth apps, or an operator can register the deployment with the provider via environment variables. The server log names what is missing.',
    status: 503,
  },
  unsupported_connector: {
    title: 'This connector cannot be connected this way',
    detail:
      'The connector you asked for is unknown, or it does not use a sign-in flow. Check the connector list in your settings.',
    status: 400,
  },
  workspace_claimed: {
    title: 'That workspace is already connected',
    detail:
      'This provider workspace is connected to a different organization. Disconnect it there first, or install the app into a workspace of your own.',
    status: 409,
  },
  storage_failed: {
    title: 'The connection could not be saved',
    detail:
      'Access was granted but storing it failed, so the connector is not connected. Try again; if it keeps failing, contact an administrator.',
    status: 500,
  },
  credential_missing: {
    title: 'This credential cannot be reconnected',
    detail:
      'It was removed, or it is not an OAuth connection of this connector, so nothing was saved and no other credential changed. Check your connector settings, and add the account again if you still need it.',
    status: 404,
  },
  account_mismatch: {
    title: 'That is a different workspace',
    detail:
      'You authorized another workspace than the one this credential connects, so nothing was saved. Reconnect again and choose the same workspace, or use Add credential to connect the other one.',
    status: 409,
  },
  forbidden: {
    title: 'You can no longer connect connectors here',
    detail:
      'Your access to this organization changed while the connection was in progress, so nothing was saved. Owners, Admins and Developers can connect connectors; ask an organization admin.',
    status: 403,
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Render the failure. `backUrl` is built from the deployment's own site URL
 * (see `deployment_config.ts`), never from request parameters. With no known
 * organization, the fixed dashboard entry resolves the returning user's own
 * organization after sign-in; an expired state must not strand the browser.
 */
export function renderConnectorErrorPage(
  kind: ConnectorErrorKind,
  backUrl?: string | null,
): Response {
  const copy = ERROR_COPY[kind];
  const backLink = `\n    <p><a href="${escapeHtml(backUrl ?? `${basePath()}/dashboard`)}">${backUrl ? 'Back to connector settings' : 'Tale'}</a></p>`;
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(copy.title)}</title>
  </head>
  <body>
    <h1>${escapeHtml(copy.title)}</h1>
    <p>${escapeHtml(copy.detail)}</p>${backLink}
  </body>
</html>
`;
  return new Response(html, {
    status: copy.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The URL of a failed callback still carries the vendor's `code`/`state`
      // in the query string; caching it anywhere would persist them.
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
