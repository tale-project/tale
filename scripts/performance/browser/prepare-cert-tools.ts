// The disposable GitHub host prepares public trust databases before the
// measured offline container starts. Never install into the measured image.
import { json, outputPath, runLogged } from './common.ts';

try {
  await runLogged('sudo', ['apt-get', 'update', '-qq'], {
    cwd: process.cwd(),
    log: outputPath('certificate-apt-update.log'),
    timeoutMs: 60_000,
  });
  await runLogged(
    'sudo',
    ['apt-get', 'install', '-y', '--no-install-recommends', 'libnss3-tools'],
    {
      cwd: process.cwd(),
      log: outputPath('certificate-apt-install.log'),
      timeoutMs: 90_000,
    },
  );
} catch (error) {
  await json('certificate-tools-failure.json', { error: String(error) });
  throw error;
}
