import { exec } from '../../src/lib/docker/exec';

const mode = process.argv[2];
if (mode !== 'explicit' && mode !== 'inherited')
  throw new Error('Missing exec fixture mode');

const results = [];
for (const input of [undefined, 'literal stdin $value\n']) {
  const script =
    'process.stdout.write(JSON.stringify({' +
    'allowed:process.env.TALE_EXEC_ALLOWED,' +
    'private:process.env.TALE_EXEC_PRIVATE_TEST,' +
    'version:process.env.VERSION,' +
    `stdin:${input === undefined ? 'undefined' : 'await Bun.stdin.text()'}` +
    '}))';
  results.push(
    await exec(process.execPath, ['-e', script], {
      silent: true,
      timeout: 3,
      ...(input === undefined ? {} : { stdin: input }),
      ...(mode === 'explicit'
        ? { env: { TALE_EXEC_ALLOWED: 'literal $value' } }
        : {}),
    }),
  );
}
process.stdout.write(JSON.stringify(results));
