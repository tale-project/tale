import { isReleaseVersion } from '../../../lib/shared/release-version.ts';

/**
 * `platform` on the workspace-status answer (`POST /api/tools/status`): the
 * release version THIS backend process is labelled with, read from the build
 * stamp the web tier's `/api/health` reports too — `TALE_VERSION`, which every
 * image build sets (a release build to its tag's number) and the environment
 * can override.
 *
 * `version` is only ever a release version (`0.5.64`, the tag without its
 * `v`), and only ever a label: any build can be stamped with one, so it is no
 * proof of what is deployed — a reader maps it to the published tag of that
 * number, and a deployment's own records say what actually runs. A stamp
 * that is not a release version answers `version: null` with a fixed
 * sentence saying which kind it is; the stamp itself is never echoed, since
 * it can hold anything. The answer names the backend that served the call,
 * not the health of the deployment.
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
    return {
      version: null,
      note: "This backend's build carries no version label.",
    };
  }
  if (build === 'dev') {
    return {
      version: null,
      note: "This backend's build is labelled as a development build, not with a release version.",
    };
  }
  return {
    version: null,
    note: "This backend's build is not labelled with a release version.",
  };
}
