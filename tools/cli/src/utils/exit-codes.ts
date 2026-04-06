// 130 = SIGINT (Unix), 143 = SIGTERM (Unix), 3221225786 = STATUS_CONTROL_C_EXIT (Windows)
export function isUserInterrupt(code: number): boolean {
  return code === 130 || code === 143 || code === 3221225786;
}
