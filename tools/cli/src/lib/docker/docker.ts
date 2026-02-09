import { type ExecResult, exec } from './exec';

export async function docker(...args: string[]): Promise<ExecResult> {
  return exec('docker', args);
}
