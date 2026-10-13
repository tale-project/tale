/**
 * Commander resolves program options anywhere on the command line, so the
 * root `--version` claims `tale update --version 0.9.0` before `update` sees
 * its own `-v, --version <version>`: the CLI printed its version, exited 0 and
 * updated nothing, and the documented way to change release lines did
 * nothing. Once `update` is the command, its `--version` is spelled as the
 * short `-v` that only `update` declares.
 *
 * `argv` is Commander's `node` shape: runtime, script, then the arguments.
 * Every root option is a flag without a value, so the first argument that is
 * not an option is the command.
 */
export function routeUpdateVersionFlag(argv: readonly string[]): string[] {
  const args = argv.slice(2);
  const command = args.findIndex((arg) => !arg.startsWith('-'));
  if (command === -1 || args[command] !== 'update') return [...argv];
  const rest = args.slice(command + 1);
  const end = rest.indexOf('--');
  const options = end === -1 ? rest : rest.slice(0, end);
  const operands = end === -1 ? [] : rest.slice(end);
  return [
    ...argv.slice(0, 2 + command + 1),
    ...options.flatMap((arg) =>
      arg === '--version'
        ? ['-v']
        : arg.startsWith('--version=')
          ? ['-v', arg.slice('--version='.length)]
          : [arg],
    ),
    ...operands,
  ];
}
