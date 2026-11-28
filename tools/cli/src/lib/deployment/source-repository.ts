/** Forgejo hosts a deployment may name as a configuration source. `prepare`
 * fetches from them over HTTPS with `TALE_SOURCE_TOKEN`; GitHub sources keep
 * their SSH path. Extend this list deliberately: a host here receives the
 * source token. */
export const FORGEJO_SOURCE_HOSTS: readonly string[] = ['git.tale.dev'];

export type SourceRepository =
  | { forge: 'github'; owner: string; name: string }
  | { forge: 'forgejo'; host: string; owner: string; name: string };

/** A canonical source repository URL: HTTPS, no userinfo, port, `.git`,
 * query or fragment, and `new URL(x).href === x`. Anything else, including
 * a host that is neither GitHub nor an allowed Forgejo host, is undefined. */
export function parseSourceRepository(
  input: string,
): SourceRepository | undefined {
  const match =
    /^https:\/\/([a-z0-9.-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)(?![\s\S])/.exec(
      input,
    );
  if (!match || input.endsWith('.git')) return undefined;
  const [, host, owner, name] = match;
  if (host === undefined || owner === undefined || name === undefined)
    return undefined;
  try {
    if (new URL(input).href !== input) return undefined;
  } catch {
    return undefined;
  }
  if (host === 'github.com') return { forge: 'github', owner, name };
  if (FORGEJO_SOURCE_HOSTS.includes(host))
    return { forge: 'forgejo', host, owner, name };
  return undefined;
}
