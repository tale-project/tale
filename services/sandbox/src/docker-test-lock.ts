/** Serialize a fake Docker daemon's JSON transaction across CLI subprocesses.
 * The real daemon owns its state; the fake must not lose concurrent writes. */
export const DOCKER_TEST_STATE_LOCK = String.raw`
const { openSync, closeSync, unlinkSync } = await import('node:fs');
const lockPath = path + '.lock';
let lock;
for (;;) {
  try {
    lock = openSync(lockPath, 'wx');
    writeFileSync(lock, String(process.pid));
    break;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const owner = Number(readFileSync(lockPath, 'utf8'));
      if (owner > 0) {
        try { process.kill(owner, 0); }
        catch (dead) { if (dead.code === 'ESRCH') unlinkSync(lockPath); }
      }
    } catch {}
    await Bun.sleep(2);
  }
}
process.on('exit', () => { closeSync(lock); unlinkSync(lockPath); });
`;
