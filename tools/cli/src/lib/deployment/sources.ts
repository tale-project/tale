import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { gitSha } from '../config/releases/model';
import { exec } from '../docker/exec';

export const TALE_REPOSITORY = 'https://github.com/tale-project/tale';
export interface SourceRequest {
  repository: string;
  revision: string;
}
type SourceMap = Record<string, string>;
const sourceKey = ({ repository, revision }: SourceRequest) =>
  `${repository}@${revision}`;

/** The metadata endpoint is authenticated by HTTPS. Do not learn an SSH key
 * from the SSH connection it is meant to authenticate (ssh-keyscan alone). */
type MetadataFetch = (url: string, init: RequestInit) => Promise<Response>;
async function githubKnownHosts(fetchImpl: MetadataFetch): Promise<string> {
  try {
    const response = await fetchImpl('https://api.github.com/meta', {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'tale-cli',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) throw new Error('metadata unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.length;
        if (size > 1_048_576) throw new Error('metadata too large');
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const metadata = z
      .object({
        ssh_keys: z
          .array(
            z
              .string()
              .regex(
                /^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/]+={0,2}(?![\s\S])/,
              ),
          )
          .min(1),
      })
      .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return metadata.ssh_keys.map((key) => `github.com ${key}\n`).join('');
  } catch {
    throw externalDepError('Could not verify GitHub SSH host keys over HTTPS.');
  }
}

const quote = (input: string) => `'${input.replaceAll("'", "'\\''")}'`;

/** All checkouts and any short-lived key are owned temporary files. Only
 * Git object content selected by the compiler crosses into a deploy bundle. */
export async function withDeploymentSources<T>(
  requests: SourceRequest[],
  options: {
    sourcesFile?: string;
    sourceKey?: string;
    fetchImpl?: MetadataFetch;
    run?: typeof exec;
  },
  body: (source: (request: SourceRequest) => string) => Promise<T>,
): Promise<T> {
  const run = options.run ?? exec;
  const provided = options.sourcesFile
    ? z
        .record(z.string(), z.string().min(1))
        .parse(JSON.parse(await readFile(options.sourcesFile, 'utf8')))
    : {};
  const root = await mkdtemp(join(tmpdir(), 'tale-deployment-sources-'));
  const sources: SourceMap = {};
  const inheritedNames = new Set([
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SYSTEMROOT',
    'WINDIR',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
  ]);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => inheritedNames.has(name)),
  );
  const empty = join(root, 'empty-config');
  const sshKey = join(root, 'source-key');
  const knownHosts = join(root, 'known-hosts');
  const hooks = join(root, 'hooks');
  try {
    await mkdir(hooks, { mode: 0o700 });
    await writeFile(empty, '', { mode: 0o600, flag: 'wx' });
    const gitEnvironment = {
      ...environment,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: empty,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_TERMINAL_PROMPT: '0',
    };
    const execute = async (directory: string, args: string[], ssh?: string) => {
      let result;
      try {
        result = await run(
          'git',
          [
            '-C',
            directory,
            '-c',
            `core.hooksPath=${hooks}`,
            '-c',
            'protocol.file.allow=never',
            '-c',
            'core.autocrlf=false',
            ...args,
          ],
          {
            env: {
              ...gitEnvironment,
              ...(ssh ? { GIT_SSH_COMMAND: ssh } : {}),
            },
            timeout: 300,
            silent: true,
          },
        );
      } catch {
        throw externalDepError(
          'Git could not acquire the pinned deployment source.',
        );
      }
      if (!result.success)
        throw externalDepError(
          'Git could not acquire the pinned deployment source. Check the repository, full commit SHA and read-only checkout key.',
        );
      return result.stdout.trim();
    };
    let ssh: string | undefined;
    let index = 0;
    for (const request of requests) {
      const revision = gitSha.parse(request.revision);
      const key = sourceKey(request);
      if (sources[key]) continue;
      const match =
        /^https:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)(?![\s\S])/.exec(
          request.repository,
        );
      if (
        !match ||
        request.repository.endsWith('.git') ||
        new URL(request.repository).href !== request.repository
      )
        throw preconditionError(
          'Deployment source must be a canonical GitHub repository URL.',
        );
      const supplied = provided[key];
      const directory = supplied
        ? resolve(supplied)
        : join(root, `repository-${index++}`);
      if (!supplied) {
        await mkdir(directory, { mode: 0o700 });
        await execute(directory, ['init', '--template=']);
        let remote = request.repository;
        let sourceSsh: string | undefined;
        // The runtime is always public. A client key is used only for a
        // declared client repository and is never passed to Docker or Tale.
        if (options.sourceKey && request.repository !== TALE_REPOSITORY) {
          if (!ssh) {
            await writeFile(sshKey, options.sourceKey, {
              mode: 0o600,
              flag: 'wx',
            });
            await writeFile(
              knownHosts,
              await githubKnownHosts(options.fetchImpl ?? fetch),
              { mode: 0o600, flag: 'wx' },
            );
            ssh = [
              'ssh',
              '-F',
              empty,
              '-i',
              sshKey,
              '-o',
              'IdentitiesOnly=yes',
              '-o',
              'BatchMode=yes',
              '-o',
              'StrictHostKeyChecking=yes',
              '-o',
              `UserKnownHostsFile=${knownHosts}`,
              '-o',
              `GlobalKnownHostsFile=${empty}`,
            ]
              .map(quote)
              .join(' ');
          }
          remote = `git@github.com:${match[1]}/${match[2]}.git`;
          sourceSsh = ssh;
        }
        await execute(directory, ['remote', 'add', 'origin', remote]);
        // Tags are required to resolve an older release image back to this
        // exact commit; none of them is accepted as the requested source pin.
        await execute(
          directory,
          ['fetch', '--depth=1', '--tags', 'origin', revision],
          sourceSsh,
        );
        await execute(directory, ['checkout', '--detach', revision]);
      }
      if ((await execute(directory, ['rev-parse', 'HEAD'])) !== revision)
        throw preconditionError(
          'Deployment checkout differs from the requested full commit SHA.',
        );
      sources[key] = directory;
    }
    return await body((request) => {
      const directory = sources[sourceKey(request)];
      if (!directory)
        throw preconditionError('Deployment source was not prepared.');
      return directory;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
