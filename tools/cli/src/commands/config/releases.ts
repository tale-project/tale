import path from 'node:path';

import { Command } from 'commander';
import { z } from 'zod';

import { verifyArtifactBytes } from '../../lib/config/releases/artifacts';
import { deployRelease, verifyRelease } from '../../lib/config/releases/deploy';
import {
  loadClient,
  releaseIdentity,
} from '../../lib/config/releases/identity';
import { loadRelease } from '../../lib/config/releases/manifest';
import {
  ConfigError,
  NativeRequestError,
  ExternalToolError,
  gitSha,
  sha,
  owner,
  relativePath,
  repository,
  slug,
  version,
} from '../../lib/config/releases/model';
import { validateNativeRelease } from '../../lib/config/releases/native';
import {
  buildRelease,
  verifyArtifact,
} from '../../lib/config/releases/release';
import {
  stageOutputDirectory,
  stageRelease,
  verifyStage,
} from '../../lib/config/releases/stage';
import { withLock } from '../../lib/state/with-lock';
import {
  CliError,
  ExitCode,
  externalDepError,
  preconditionError,
  usageError,
} from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { confirm, NonInteractiveError } from '../../utils/prompt';
import { action } from '../../utils/run-command';

interface SourceFlags {
  repo: string;
  descriptor: string;
  automation: string;
}
interface BuildFlags extends SourceFlags {
  sourceCommit: string;
  configVersion?: string;
  output?: string;
  skillOwner?: string;
}
interface VerifyFlags extends SourceFlags {
  manifest: string;
  rebuild?: boolean;
}
interface StageFlags extends SourceFlags {
  configVersion?: string;
  configRef?: string;
  catalogueCommit?: string;
  catalogueRepository?: string;
  client?: string;
  opsCommit?: string;
  deploymentRef?: string;
  skillOwner?: string;
  output: string;
}
interface RemoteFlags {
  stage: string;
  project: string;
  url: string;
  origin?: string;
  org: string;
  receipt?: string;
  nativeVersion?: string;
  allowRetained?: boolean;
  client?: string;
  automation?: string;
  configVersion?: string;
  configRef?: string;
  deploymentRef?: string;
  sourceRepository?: string;
  artifactSha256?: string;
  catalogueCommit?: string;
  catalogueRepository?: string;
  opsCommit?: string;
}

/** Only deliberate, bounded operational errors reach the CLI renderer. In
 * particular, native response bodies and credential-bearing fetch errors never
 * become a verbose cause or a JSON error payload. */
function releaseAction<T>(verb: string, body: (flags: T) => Promise<unknown>) {
  return action(async (flags: T) => {
    let data: unknown;
    try {
      data = await body(flags);
    } catch (error) {
      if (error instanceof CliError || error instanceof NonInteractiveError)
        throw error;
      if (
        error instanceof NativeRequestError ||
        error instanceof ExternalToolError
      )
        throw externalDepError(error.message);
      if (error instanceof ConfigError) throw preconditionError(error.message);
      if (error instanceof z.ZodError)
        throw preconditionError(
          'Configuration input does not match its schema.',
        );
      throw preconditionError(
        'Configuration operation failed.',
        'Check the source, artifact and receipt paths, permissions, and native target.',
      );
    }
    if (getOutputMode().json) emitJson(`config ${verb}`, data);
    else {
      logger.success(`Configuration ${verb} completed.`);
      logger.info(JSON.stringify(data, null, 2));
    }
  });
}

function input<S extends z.ZodType>(
  schema: S,
  value: unknown,
  flag: string,
): z.infer<S> {
  const checked = schema.safeParse(value);
  if (!checked.success) throw usageError(`Invalid ${flag}.`);
  return checked.data;
}
function source(flags: SourceFlags) {
  const repoRoot = path.resolve(flags.repo);
  const descriptor = input(relativePath, flags.descriptor, '--descriptor');
  return {
    repoRoot,
    descriptorPath: path.resolve(repoRoot, descriptor),
    automationName: input(slug, flags.automation, '--automation'),
  };
}
function sourceFlags(command: Command): Command {
  return command
    .requiredOption('--repo <directory>', 'Client repository checkout')
    .requiredOption(
      '--descriptor <path>',
      'Descriptor path relative to the repository',
    )
    .requiredOption(
      '--automation <name>',
      'Automation declared by the client descriptor',
    );
}
function summary(release: Awaited<ReturnType<typeof buildRelease>>) {
  return {
    automationName: release.manifest.automationName,
    ...(release.manifest.schemaVersion === 4
      ? { releaseRef: releaseIdentity(release.manifest) }
      : { configVersion: releaseIdentity(release.manifest) }),
    sourceCommit: release.manifest.sourceCommit,
    artifactSha256: release.manifest.artifact.sha256,
    artifactPath: release.artifactPath,
    verified: true,
  };
}

export function addReleaseCommands(config: Command): void {
  sourceFlags(
    config
      .command('build')
      .description(
        'Build an immutable configuration release from committed source',
      ),
  )
    .requiredOption(
      '--source-commit <sha>',
      'Exact source commit (40 hexadecimal characters)',
    )
    .option(
      '--config-version <version>',
      'Explicit compatibility version; default identity is the full source commit',
    )
    .option(
      '--output <directory>',
      'Release output directory; default is the declared catalogue',
    )
    .option(
      '--skill-owner <user-id>',
      'Native user ID compiled into owned skills',
    )
    .action(
      releaseAction<BuildFlags>('build', async (flags) => {
        const options = source(flags);
        return withLock(
          flags.output === undefined
            ? options.repoRoot
            : path.dirname(path.resolve(flags.output)),
          'config build',
          async () =>
            summary(
              await buildRelease({
                ...options,
                sourceCommit: input(
                  gitSha,
                  flags.sourceCommit,
                  '--source-commit',
                ),
                version:
                  flags.configVersion === undefined
                    ? undefined
                    : input(version, flags.configVersion, '--config-version'),
                output: flags.output,
                skillOwnerUserId:
                  flags.skillOwner === undefined
                    ? undefined
                    : input(owner, flags.skillOwner, '--skill-owner'),
                validateNative: validateNativeRelease,
              }),
            ),
        );
      }),
    );

  sourceFlags(
    config
      .command('verify')
      .description('Verify a release and its source provenance'),
  )
    .requiredOption(
      '--manifest <path>',
      'Release manifest path, absolute or relative to the repository',
    )
    .option('--rebuild', 'Rebuild offline and require exact archive bytes')
    .action(
      releaseAction<VerifyFlags>('verify', async (flags) => {
        const options = source(flags);
        return summary(
          await verifyArtifact({
            ...options,
            manifestPath: path.isAbsolute(flags.manifest)
              ? path.resolve(flags.manifest)
              : path.resolve(
                  options.repoRoot,
                  input(relativePath, flags.manifest, '--manifest'),
                ),
            rebuild: flags.rebuild,
            validateNative: validateNativeRelease,
          }),
        );
      }),
    );

  sourceFlags(
    config
      .command('stage')
      .description(
        'Rebuild and stage an exact committed client release for transfer',
      ),
  )
    .option(
      '--config-version <version>',
      'Compatibility version from a committed catalogue',
    )
    .option(
      '--config-ref <sha>',
      'Build and stage this exact source commit without a catalogue release',
    )
    .option(
      '--skill-owner <user-id>',
      'Native owner compiled into SHA-addressed owned skills',
    )
    .option(
      '--deployment-ref <sha>',
      'Optional orchestrator revision for a SHA-addressed stage',
    )
    .option('--catalogue-commit <sha>', 'Exact catalogue checkout commit')
    .option(
      '--catalogue-repository <url>',
      'Expected source repository declaration',
    )
    .option('--client <name>', 'Expected client identity')
    .option('--ops-commit <sha>', 'Orchestrator commit recorded in the stage')
    .requiredOption(
      '--output <directory>',
      'Destination for the allowlisted stage',
    )
    .action(
      releaseAction<StageFlags>('stage', async (flags) => {
        const options = source(flags);
        if (
          (flags.configRef === undefined) ===
          (flags.configVersion === undefined)
        )
          throw usageError(
            'Select exactly one --config-ref or --config-version.',
          );
        const output = stageOutputDirectory(options.repoRoot, flags.output);
        return withLock(path.dirname(output), 'config stage', () =>
          stageRelease({
            ...options,
            descriptorPath: flags.descriptor,
            version:
              flags.configVersion === undefined
                ? undefined
                : input(version, flags.configVersion, '--config-version'),
            configRef:
              flags.configRef === undefined
                ? undefined
                : input(gitSha, flags.configRef, '--config-ref'),
            skillOwnerUserId:
              flags.skillOwner === undefined
                ? undefined
                : input(owner, flags.skillOwner, '--skill-owner'),
            deploymentRef:
              flags.deploymentRef === undefined
                ? undefined
                : input(gitSha, flags.deploymentRef, '--deployment-ref'),
            catalogueCommit:
              flags.catalogueCommit === undefined
                ? undefined
                : input(gitSha, flags.catalogueCommit, '--catalogue-commit'),
            catalogueRepository:
              flags.catalogueRepository === undefined
                ? undefined
                : input(
                    repository,
                    flags.catalogueRepository,
                    '--catalogue-repository',
                  ),
            clientId:
              flags.client === undefined
                ? undefined
                : input(slug, flags.client, '--client'),
            opsCommit:
              flags.opsCommit === undefined
                ? undefined
                : input(gitSha, flags.opsCommit, '--ops-commit'),
            output,
          }),
        );
      }),
    );

  for (const verb of ['deploy', 'verify-native'] as const) {
    const command = config
      .command(verb)
      .description(
        verb === 'deploy'
          ? 'Install and deploy a staged configuration through the native API'
          : 'Read back a staged release and every owned native skill asset',
      );
    command
      .requiredOption(
        '--stage <directory>',
        'Verified stage containing deployment.json',
      )
      .requiredOption('--project <id>', 'Native bootstrap project ID')
      .requiredOption(
        '--url <origin>',
        'Tale HTTPS origin (HTTP allowed on loopback)',
      )
      .option(
        '--origin <origin>',
        'Public HTTPS origin when connecting over loopback',
      )
      .requiredOption('--org <id>', 'Native organization ID')
      .option('--client <name>', 'Require this staged client identity')
      .option('--automation <name>', 'Require this staged automation identity')
      .option(
        '--config-version <version>',
        'Require this staged configuration version',
      )
      .option(
        '--config-ref <sha>',
        'Require this exact source release identity',
      )
      .option(
        '--source-repository <url>',
        'Require this SHA-stage source repository',
      )
      .option(
        '--artifact-sha256 <sha>',
        'Require this exact canonical artifact digest',
      )
      .option(
        '--deployment-ref <sha>',
        'Require this SHA-stage orchestrator revision',
      )
      .option(
        '--catalogue-commit <sha>',
        'Require this exact staged catalogue commit',
      )
      .option(
        '--catalogue-repository <url>',
        'Require this staged source repository',
      )
      .option('--ops-commit <sha>', 'Require this staged orchestrator commit');
    if (verb === 'deploy')
      command.requiredOption(
        '--receipt <path>',
        'Persistent native deployment receipt',
      );
    else
      command
        .option(
          '--native-version <number>',
          'Read this retained native automation version',
        )
        .option(
          '--allow-retained',
          'Verify without requiring the current deployment pointer',
        );
    command.action(
      releaseAction<RemoteFlags>(verb, async (flags) => {
        const staged = verifyStage(path.resolve(flags.stage), {
          clientId:
            flags.client === undefined
              ? undefined
              : input(slug, flags.client, '--client'),
          automationName:
            flags.automation === undefined
              ? undefined
              : input(slug, flags.automation, '--automation'),
          configVersion:
            flags.configVersion === undefined
              ? undefined
              : input(version, flags.configVersion, '--config-version'),
          releaseRef:
            flags.configRef === undefined
              ? undefined
              : input(gitSha, flags.configRef, '--config-ref'),
          sourceRepository:
            flags.sourceRepository === undefined
              ? undefined
              : input(
                  repository,
                  flags.sourceRepository,
                  '--source-repository',
                ),
          artifactSha256:
            flags.artifactSha256 === undefined
              ? undefined
              : input(sha, flags.artifactSha256, '--artifact-sha256'),
          deploymentRef:
            flags.deploymentRef === undefined
              ? undefined
              : input(gitSha, flags.deploymentRef, '--deployment-ref'),
          catalogueCommit:
            flags.catalogueCommit === undefined
              ? undefined
              : input(gitSha, flags.catalogueCommit, '--catalogue-commit'),
          catalogueRepository:
            flags.catalogueRepository === undefined
              ? undefined
              : input(
                  repository,
                  flags.catalogueRepository,
                  '--catalogue-repository',
                ),
          opsCommit:
            flags.opsCommit === undefined
              ? undefined
              : input(gitSha, flags.opsCommit, '--ops-commit'),
        });
        const release = loadRelease(
          staged.manifestPath,
          loadClient(staged.descriptorPath, staged.automationName),
        );
        await verifyArtifactBytes(release);
        await validateNativeRelease(release);
        const cookie = process.env.TALE_CONFIG_COOKIE;
        if (!cookie || /[\r\n]/.test(cookie))
          throw preconditionError(
            'TALE_CONFIG_COOKIE must contain a native session cookie.',
          );
        const options = {
          descriptorPath: staged.descriptorPath,
          automationName: staged.automationName,
          manifestPath: staged.manifestPath,
          url: flags.url,
          origin: flags.origin,
          orgId: flags.org,
          projectId: flags.project,
          cookie,
          receiptPath:
            flags.receipt === undefined
              ? undefined
              : path.resolve(flags.receipt),
          automationVersion:
            flags.nativeVersion === undefined
              ? undefined
              : input(
                  z.coerce.number().int().positive().safe(),
                  flags.nativeVersion,
                  '--native-version',
                ),
          requireDeployed: !flags.allowRetained,
          deployment:
            staged.schemaVersion === 1
              ? {
                  opsCommit: staged.opsCommit,
                  catalogueCommit: staged.catalogueCommit,
                  catalogueRepository: staged.catalogueRepository,
                }
              : staged.deploymentRef === undefined
                ? undefined
                : { deploymentRef: staged.deploymentRef },
        };
        if (verb === 'verify-native') return verifyRelease(options);
        // A stable receipt directory serializes native mutation across stages and
        // versions on this host. Ops additionally holds its whole-stack host lock.
        if (!options.receiptPath) throw usageError('--receipt is required.');
        if (
          !(await confirm({
            message: `Deploy ${staged.automationName} ${releaseIdentity(release.manifest)} to ${flags.org}?`,
            default: true,
          }))
        )
          throw new CliError({
            summary: 'Configuration deployment cancelled.',
            code: ExitCode.UserAbort,
          });
        return withLock(
          path.dirname(options.receiptPath),
          'config deploy',
          () => deployRelease(options),
        );
      }),
    );
  }
}
