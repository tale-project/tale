import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { gitSha } from '../config/releases/model';
import { exec } from '../docker/exec';
import { parseSourceRepository } from './source-repository';

export const TALE_REPOSITORY = 'https://github.com/tale-project/tale';
export interface SourceRequest {
  repository: string;
  revision: string;
}
type SourceMap = Record<string, string>;
type SourceKind = 'runtime' | 'configuration';
type SourceStage =
  | 'init'
  | 'remote'
  | 'tags'
  | 'fetch'
  | 'checkout'
  | 'rev-parse';
/** Every Git step but the transfer is local or a short listing. */
const GIT_STEP_SECONDS = 300;
/** A shallow commit of the runtime is hundreds of MiB: a runner on a slow
 * uplink needs longer than a local step to receive it. A stalled transfer
 * still fails fast, by Git's own low-speed abort below. */
const GIT_FETCH_SECONDS = 1800;
const GIT_LOW_SPEED_BYTES_PER_SECOND = '1024';
const GIT_LOW_SPEED_SECONDS = '120';
/** Tag names Git may take as a refspec: no option, pattern or range. */
const fetchableTag =
  /^refs\/tags\/(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*(?<![./])$/;
const MAX_SOURCE_TAGS = 64;

/** The tags of the remote whose commit is the pinned revision, from a
 * `git ls-remote --tags` listing: an annotated tag by its peeled line, a
 * lightweight one by its own. Every other tag stays on the server. */
export function tagsAtRevision(listing: string, revision: string): string[] {
  const tags = new Set<string>();
  for (const line of listing.split('\n')) {
    const [object, reference, ...rest] = line.trim().split('\t');
    if (object !== revision || !reference || rest.length > 0) continue;
    const name = reference.endsWith('^{}')
      ? reference.slice(0, -'^{}'.length)
      : reference;
    if (fetchableTag.test(name)) tags.add(name);
  }
  return [...tags].sort().slice(0, MAX_SOURCE_TAGS);
}
const sourceKey = ({ repository, revision }: SourceRequest) =>
  `${repository}@${revision}`;

// Output is diagnostic input only: emit authored hints, never Git's text,
// repository URLs, temporary paths or a possibly credential-bearing cause.
function stderrHint(stderr: string) {
  const text = stderr.toLowerCase();
  if (text.includes('no space left on device')) return 'no-space';
  if (text.includes('could not resolve host')) return 'name-resolution';
  if (
    text.includes('authentication failed') ||
    text.includes('could not read username') ||
    text.includes('could not read password') ||
    text.includes('returned error: 401') ||
    text.includes('returned error: 403')
  )
    return 'authentication';
  return 'unknown';
}

function thrownHint(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'Command exceeded its time limit.') return 'timeout';
    if (error.message === 'Command output exceeded its byte limit.')
      return 'output-limit';
  }
  return 'unknown';
}

function acquisitionError(
  kind: SourceKind,
  stage: SourceStage,
  hint: ReturnType<typeof stderrHint> | ReturnType<typeof thrownHint>,
  exitCode?: number,
) {
  const exit =
    exitCode !== undefined &&
    Number.isSafeInteger(exitCode) &&
    exitCode > 0 &&
    exitCode <= 255
      ? exitCode
      : 'unknown';
  // An authored sentence only: never the token, the URL or the server's text.
  const reason =
    hint === 'authentication'
      ? ' The source token cannot read the repository.'
      : '';
  return externalDepError(
    `Git could not acquire the pinned ${kind} deployment source during ${stage} (exit ${exit}; failure hint: ${hint}).${reason}`,
  );
}

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

/** Git reads the token from its environment config, scoped to the one host:
 * never argv, a remote URL, a credential helper or a file. Redirects are not
 * followed, so the header cannot reach another host. Forgejo takes an access
 * token as the password of HTTPS Basic authentication. */
function tokenEnvironment(host: string, token: string): Record<string, string> {
  const basic = Buffer.from(`tale-source:${token}`, 'utf8').toString('base64');
  return {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: `http.https://${host}/.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
    GIT_CONFIG_KEY_2: 'http.followRedirects',
    GIT_CONFIG_VALUE_2: 'false',
  };
}

/** All checkouts and any short-lived key are owned temporary files. Only
 * Git object content selected by the compiler crosses into a deploy bundle. */
export async function withDeploymentSources<T>(
  requests: SourceRequest[],
  options: {
    sourcesFile?: string;
    sourceKey?: string;
    /** Read only for a configuration source on an allowed Forgejo host. */
    sourceToken?: string;
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
  // Every source is judged before any Git or network step, so an off-list
  // host or a missing token fails before the runtime is fetched.
  const parsed = requests.map((request) => {
    const repository = parseSourceRepository(request.repository);
    if (!repository)
      throw preconditionError(
        'Deployment source must be a canonical GitHub repository URL or one on an allowed Forgejo host.',
      );
    if (
      repository.forge === 'forgejo' &&
      !provided[sourceKey(request)] &&
      !options.sourceToken
    )
      throw preconditionError(
        'A configuration source on an allowed Forgejo host needs TALE_SOURCE_TOKEN in the prepare environment.',
      );
    return repository;
  });
  if (
    options.sourceToken !== undefined &&
    parsed.some((repository) => repository.forge === 'forgejo') &&
    !/^[\x21-\x7e]+(?![\s\S])/.test(options.sourceToken)
  )
    throw preconditionError(
      'TALE_SOURCE_TOKEN must be one line of printable characters.',
    );
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
    const execute = async (
      directory: string,
      kind: SourceKind,
      stage: SourceStage,
      args: string[],
      extraEnvironment?: Record<string, string>,
    ) => {
      const network = stage === 'tags' || stage === 'fetch';
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
            ...(network
              ? [
                  '-c',
                  `http.lowSpeedLimit=${GIT_LOW_SPEED_BYTES_PER_SECOND}`,
                  '-c',
                  `http.lowSpeedTime=${GIT_LOW_SPEED_SECONDS}`,
                ]
              : []),
            ...args,
          ],
          {
            env: {
              ...gitEnvironment,
              ...extraEnvironment,
            },
            timeout: stage === 'fetch' ? GIT_FETCH_SECONDS : GIT_STEP_SECONDS,
            maxOutputBytes: 1_048_576,
            silent: true,
          },
        );
      } catch (error) {
        throw acquisitionError(kind, stage, thrownHint(error));
      }
      if (!result.success)
        throw acquisitionError(
          kind,
          stage,
          stderrHint(result.stderr),
          result.exitCode,
        );
      return result.stdout.trim();
    };
    let ssh: string | undefined;
    let index = 0;
    for (const [position, request] of requests.entries()) {
      const repository = parsed[position];
      if (!repository)
        throw preconditionError('Deployment source was not judged.');
      const revision = gitSha.parse(request.revision);
      const kind =
        request.repository === TALE_REPOSITORY ? 'runtime' : 'configuration';
      const key = sourceKey(request);
      if (sources[key]) continue;
      const supplied = provided[key];
      const directory = supplied
        ? resolve(supplied)
        : join(root, `repository-${index++}`);
      if (!supplied) {
        await mkdir(directory, { mode: 0o700 });
        await execute(directory, kind, 'init', ['init', '--template=']);
        let remote = request.repository;
        let fetchEnvironment: Record<string, string> | undefined;
        // The runtime is always public. A client key or token is used only for
        // a declared client repository and is never passed to Docker or Tale.
        if (repository.forge === 'forgejo' && options.sourceToken) {
          fetchEnvironment = tokenEnvironment(
            repository.host,
            options.sourceToken,
          );
        } else if (
          repository.forge === 'github' &&
          options.sourceKey &&
          request.repository !== TALE_REPOSITORY
        ) {
          if (!ssh) {
            // Secret transports may remove the final newline; OpenSSH needs it.
            // Normalize text line endings without trimming the key payload.
            const privateKey = options.sourceKey.replaceAll('\r\n', '\n');
            await writeFile(
              sshKey,
              privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`,
              {
                mode: 0o600,
                flag: 'wx',
              },
            );
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
          remote = `git@github.com:${repository.owner}/${repository.name}.git`;
          fetchEnvironment = { GIT_SSH_COMMAND: ssh };
        }
        await execute(directory, kind, 'remote', [
          'remote',
          'add',
          'origin',
          remote,
        ]);
        // The tags AT this commit resolve an older release image back to it;
        // none of them is accepted as the requested source pin. Only those
        // are fetched: `--tags` would bring every tagged commit's whole tree
        // as well, twice the runtime's bytes, for tags nothing reads.
        const tags = tagsAtRevision(
          await execute(
            directory,
            kind,
            'tags',
            ['ls-remote', '--tags', 'origin'],
            fetchEnvironment,
          ),
          revision,
        );
        await execute(
          directory,
          kind,
          'fetch',
          [
            'fetch',
            '--depth=1',
            '--no-tags',
            'origin',
            revision,
            ...tags.map((tag) => `+${tag}:${tag}`),
          ],
          fetchEnvironment,
        );
        await execute(directory, kind, 'checkout', [
          'checkout',
          '--detach',
          revision,
        ]);
      }
      if (
        (await execute(directory, kind, 'rev-parse', ['rev-parse', 'HEAD'])) !==
        revision
      )
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
