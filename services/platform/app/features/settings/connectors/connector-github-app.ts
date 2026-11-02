import { getEnv } from '@/lib/env';

/**
 * The hand-offs of a connector credential that signs in as the
 * organization's own GitHub App (`github-app`).
 *
 * The deployment owns both flows, as it owns OAuth consent: its
 * `/api/connectors/github-app/register` route re-checks that the member is an
 * admin, keeps the pending registration server-side and posts the app's
 * manifest to GitHub; `/install` sends the browser to the app's installation
 * page, where the repositories are chosen. GitHub hands the browser back to
 * the deployment, which stores the app or its installation and returns to
 * the connector settings. So the page only builds the URL and leaves — a
 * full-page navigation, never a popup, for the same reasons as OAuth's.
 */

/**
 * The longest app name GitHub takes, in characters. Mirrors the register
 * route's own check (`GITHUB_APP_NAME_MAX` in
 * `backend/core/connector_credentials/github_app.ts`, a server module the
 * browser bundle must not import).
 */
export const GITHUB_APP_NAME_MAX = 34;

/** A GitHub account login: letters, digits and single inner hyphens — the
 * register route's `GITHUB_LOGIN_RE`, mirrored for the same reason. */
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/;

/** What the register route refuses inside an app name. */
const CONTROL_CHARACTER_RE = /\p{Cc}/u;

/** A run of whitespace or control characters, which a name folds into one
 * space. */
const BLANK_RUN_RE = /[\s\p{Cc}]+/gu;

/** What a registration is for: the credential it becomes and the app it
 * asks GitHub for. */
export interface GithubAppRegistration {
  organizationId: string;
  connectorSlug: string;
  /** The name the stored credential takes in Tale. */
  credentialName: string;
  /** The app's name on GitHub. */
  appName: string;
  /** The GitHub organization to register the app for; blank registers it
   * on the signed-in person's own account. */
  owner?: string;
}

function githubAppRouteUrl(route: 'register' | 'install'): URL {
  const siteUrl = getEnv('SITE_URL');
  const basePath = getEnv('BASE_PATH');
  return new URL(`${siteUrl}${basePath}/api/connectors/github-app/${route}`);
}

/** The deployment's URL that registers a new GitHub App for a connector. */
export function githubAppRegisterUrl(
  registration: GithubAppRegistration,
): string {
  const url = githubAppRouteUrl('register');
  url.searchParams.set('organizationId', registration.organizationId);
  url.searchParams.set('connectorSlug', registration.connectorSlug);
  url.searchParams.set('credentialName', registration.credentialName.trim());
  url.searchParams.set('appName', registration.appName.trim());
  const owner = registration.owner?.trim() ?? '';
  if (owner !== '') url.searchParams.set('owner', owner);
  return url.toString();
}

/**
 * The deployment's URL that installs a credential's app on GitHub — or, for
 * an app already installed, changes the repositories it reaches: GitHub's
 * installation page configures an existing installation too, and the
 * return records what changed.
 */
export function githubAppInstallUrl(
  organizationId: string,
  credentialId: string,
): string {
  const url = githubAppRouteUrl('install');
  url.searchParams.set('organizationId', organizationId);
  url.searchParams.set('credentialId', credentialId);
  return url.toString();
}

/** The app's public page on GitHub. */
export function githubAppPageUrl(slug: string): string {
  return `https://github.com/apps/${encodeURIComponent(slug)}`;
}

/**
 * The app name a registration suggests: "Tale" and the organization's name,
 * cut to what GitHub takes. Cut between characters, never inside one, and
 * counted in UTF-16 units as the field's `maxLength` counts — which is never
 * more characters than the server allows.
 */
export function defaultGithubAppName(organizationName?: string): string {
  const organization = (organizationName ?? '')
    .replace(BLANK_RUN_RE, ' ')
    .trim();
  const full = organization === '' ? 'Tale' : `Tale ${organization}`;
  let name = '';
  for (const character of full) {
    if (name.length + character.length > GITHUB_APP_NAME_MAX) break;
    name += character;
  }
  return name.trimEnd();
}

/** Whether a name is one the register route takes for the app. */
export function isGithubAppName(value: string): boolean {
  const name = value.trim();
  const length = [...name].length;
  return (
    length > 0 &&
    length <= GITHUB_APP_NAME_MAX &&
    !CONTROL_CHARACTER_RE.test(name)
  );
}

/** Whether a value is a GitHub account login (the app's owner). */
export function isGithubLogin(value: string): boolean {
  return GITHUB_LOGIN_RE.test(value.trim());
}

/** Leave the page for one of the routes above. */
export function leavePageFor(url: string): void {
  globalThis.location.assign(url);
}
