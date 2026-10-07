// Keep executable startup separate: bundling an importing test also flattens import.meta.url.
import { runLazyDockerSupervisor } from './lazy-docker';

void runLazyDockerSupervisor().catch((error: unknown) => {
  console.error(
    '[lazy-docker] supervisor failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
