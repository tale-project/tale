/**
 * The argument names an ICU message reads, in every branch of its `select`
 * and `plural` arguments, for the guards that hold a catalog's sentences to
 * the params their code carries. Quoted text (`'{{'`) is literal.
 */
export function icuArguments(message: string): Set<string> {
  const names = new Set<string>();
  let i = 0;
  const skipSpace = () => {
    while (i < message.length && /\s/.test(message[i] ?? '')) i++;
  };
  const word = (): string => {
    skipSpace();
    const start = i;
    while (i < message.length && !/[\s,{}]/.test(message[i] ?? '')) i++;
    return message.slice(start, i);
  };
  const text = (nested: boolean): void => {
    while (i < message.length) {
      const ch = message[i];
      if (ch === "'") {
        const next = message[i + 1];
        if (next === "'") {
          i += 2;
        } else if (next === '{' || next === '}' || next === '#') {
          const end = message.indexOf("'", i + 1);
          i = end === -1 ? message.length : end + 1;
        } else {
          i++;
        }
      } else if (ch === '{') {
        i++;
        argument();
      } else if (ch === '}') {
        if (nested) return;
        i++;
      } else {
        i++;
      }
    }
  };
  const argument = (): void => {
    names.add(word());
    skipSpace();
    if (message[i] === '}') {
      i++;
      return;
    }
    if (message[i] !== ',') throw new Error(`malformed argument: ${message}`);
    i++;
    const type = word();
    skipSpace();
    if (type !== 'select' && type !== 'plural' && type !== 'selectordinal') {
      const end = message.indexOf('}', i);
      i = end === -1 ? message.length : end + 1;
      return;
    }
    if (message[i] !== ',') throw new Error(`malformed ${type}: ${message}`);
    i++;
    for (;;) {
      skipSpace();
      if (message[i] === '}') {
        i++;
        return;
      }
      if (word() === '') throw new Error(`malformed option: ${message}`);
      skipSpace();
      if (message[i] !== '{') throw new Error(`malformed option: ${message}`);
      i++;
      text(true);
      i++;
    }
  };
  text(false);
  return names;
}
