/**
 * A published Tale release version, the form every release image carries in
 * `TALE_VERSION`: `release.yml` builds a release tag (`v0.5.64` or `0.5.64`)
 * with `VERSION` set to its number without the `v`, after checking this same
 * shape (`0.5.64`, or a prerelease such as `0.6.0-rc.1`). No other build
 * label is a release: the Build workflow's `candidate-sha-…`, `pr-…-sha-…`
 * and `sha-…` images, a local `dev` build, or anything else an image was
 * stamped with.
 */
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Whether `value` is exactly a release version: no `v`, no whitespace. */
export function isReleaseVersion(value: string): boolean {
  return RELEASE_VERSION.test(value);
}
