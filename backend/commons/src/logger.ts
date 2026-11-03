type Props = Record<string, unknown>;

export interface Logger {
  debug(message: string, props?: Props): void;
  info(message: string, props?: Props): void;
  warn(message: string, props?: Props): void;
  error(message: string, props?: Props): void;
}

/**
 * `logger("todo/service")`. Log a constant message and put everything that
 * varies in props; never put secrets, passwords or tokens in a prop.
 */
export function logger(module: string): Logger {
  const write = (level: string, message: string, props?: Props) => {
    const line = { level, module, message, ...serialize(props) };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  };
  return {
    debug: (m, p) => write("debug", m, p),
    info: (m, p) => write("info", m, p),
    warn: (m, p) => write("warn", m, p),
    error: (m, p) => write("error", m, p),
  };
}

function serialize(props?: Props): Props {
  if (!props) return {};
  const out: Props = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] =
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value;
  }
  return out;
}
