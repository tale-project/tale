import * as readline from 'node:readline';

export async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/** The choices a per-step migration review offers. */
export type StepChoice = 'yes' | 'skip' | 'accept-all' | 'abort';

/**
 * Prompt for a per-step decision in `tale migrate --step`. Returns:
 *  - `yes`        run this one step, then ask again at the next
 *  - `skip`       do not run this step, advance to the next
 *  - `accept-all` run this and every remaining step without prompting
 *  - `abort`      stop the whole run now (already-applied steps stay applied)
 *
 * Empty / unrecognized input defaults to `abort` — the safe choice.
 */
export async function confirmChoice(message: string): Promise<StepChoice> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `${message} [y]es / [s]kip / [a]ccept-all / [q]uit: `,
      (raw) => {
        rl.close();
        switch (raw.trim().toLowerCase()) {
          case 'y':
          case 'yes':
            return resolve('yes');
          case 's':
          case 'skip':
            return resolve('skip');
          case 'a':
          case 'all':
          case 'accept-all':
            return resolve('accept-all');
          default:
            return resolve('abort');
        }
      },
    );
  });
}
