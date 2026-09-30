import { isReleaseVersion } from '../../../lib/shared/release-version.ts';

/**
 * `platform` on the workspace-status answer (`POST /api/tools/status`): the
 * release THIS backend process runs, read from the build stamp the web
 * tier's `/api/health` reports too — `TALE_VERSION`, which every image build
 * sets and a release build sets to the release number.
 *
 * `version` is only ever a release version (`0.5.64`, the tag without its
 * `v`), so a reader that maps it to its release tag confirms exactly that
 * build. A development, unreleased or unreadable build answers
 * `version: null` with a fixed sentence saying which; its label is never
 * echoed, because an image can be stamped with anything. The answer names
 * the backend that served the call, not the health of the deployment.
 */
export interface ServingPlatform {
  version: string | null;
  /** Why no release version is reported; absent when `version` is one. */
  note?: string;
}

export function servingPlatform(
  env: NodeJS.ProcessEnv = process.env,
): ServingPlatform {
  const build = env.TALE_VERSION?.trim() ?? '';
  if (isReleaseVersion(build)) return { version: build };
  if (build === '') {
    return { version: null, note: 'This backend reports no build version.' };
  }
  if (build === 'dev') {
    return {
      version: null,
      note: 'This backend runs a development build, not a published release.',
    };
  }
  return {
    version: null,
    note: 'This backend runs a build that is not labelled as a published release.',
  };
}
