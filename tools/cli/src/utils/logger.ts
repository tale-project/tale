const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";

function timestamp() {
  return new Date().toISOString().substring(11, 19);
}

export function info(message: string) {
  console.log(`${DIM}[${timestamp()}]${RESET} ${BLUE}INFO${RESET}  ${message}`);
}

export function success(message: string) {
  console.log(
    `${DIM}[${timestamp()}]${RESET} ${GREEN}${BOLD}OK${RESET}    ${message}`
  );
}

export function warn(message: string) {
  console.log(
    `${DIM}[${timestamp()}]${RESET} ${YELLOW}WARN${RESET}  ${message}`
  );
}

export function error(message: string) {
  console.error(
    `${DIM}[${timestamp()}]${RESET} ${RED}${BOLD}ERROR${RESET} ${message}`
  );
}

export function step(message: string) {
  console.log(`${DIM}[${timestamp()}]${RESET} ${CYAN}STEP${RESET}  ${message}`);
}

export function debug(message: string) {
  if (process.env.DEBUG) {
    console.log(`${DIM}[${timestamp()}] DEBUG ${message}${RESET}`);
  }
}

export function blank() {
  console.log();
}

export function header(title: string) {
  blank();
  console.log(`${BOLD}${CYAN}=== ${title} ===${RESET}`);
  blank();
}

export function table(rows: [string, string][]) {
  const maxKeyLength = Math.max(...rows.map(([key]) => key.length));
  for (const [key, value] of rows) {
    console.log(`  ${key.padEnd(maxKeyLength)}  ${DIM}${value}${RESET}`);
  }
}
