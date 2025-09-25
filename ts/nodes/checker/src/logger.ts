import dotenv from 'dotenv';
import { dirname, join } from 'path';
import pino, { Logger, LoggerOptions } from 'pino';

const checkerDir = dirname(import.meta.dirname);
const envPath = join(checkerDir, '.env');
dotenv.config({ path: envPath });

const levelFromEnv = (raw?: string): string => {
  const map: Record<number, string> = { 0: 'trace', 1: 'trace', 2: 'debug', 3: 'info', 4: 'warn', 5: 'error', 6: 'fatal' };
  if (raw && /^\d+$/.test(raw)) return map[parseInt(raw, 10)] ?? 'info';
  return (raw?.toLowerCase() as LoggerOptions['level']) || 'info';
};

const isJsonFormat = () => process.env.LOG_FORMAT === 'json';

const prettyOptions = {
  colorize: true,
  singleLine: true,
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l o',
  ignore: 'pid,hostname',
} as const;

let rootLogger: Logger | null = null;

export function createLoggerOptions(name?: string): LoggerOptions {
  const level = levelFromEnv(process.env.LOG_LEVEL);
  const options: LoggerOptions = { level };
  if (name) {
    (options as any).base = { name };
  }
  if (!isJsonFormat()) {
    options.transport = { target: 'pino-pretty', options: prettyOptions } as any;
  }
  return options;
}

function createRootLogger(): Logger {
  return pino(createLoggerOptions());
}

export function getRootLogger(): Logger {
  if (!rootLogger) rootLogger = createRootLogger();
  return rootLogger;
}

export function getLogger(name: string): Logger {
  return getRootLogger().child({ name });
}
