// Offline CLI: analyze a recorded session JSON file and print the report.
//   bun src/cli.ts <recording.json> [--full]
// Prints the lean compact report by default; --full emits the faithful Report.
// Same offline pipeline the driver uses, decoupled from any browser.

import { compactReport } from './compact';
import { loadRecording } from './recording';
import { buildReport } from './report';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const path = args.find((a) => !a.startsWith('-'));
  if (!path) {
    console.error('usage: bun src/cli.ts <recording.json> [--full]');
    process.exitCode = 1;
    return;
  }
  const report = buildReport(loadRecording(await Bun.file(path).text()));
  const output = full ? report : compactReport(report);
  console.log(JSON.stringify(output, null, 2));
}

// Only run when invoked directly. A missing file or malformed recording should
// read as a one-line error, not an unhandled-rejection stack trace.
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
