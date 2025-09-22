import pino, { LoggerOptions } from 'pino';
import pretty from 'pino-pretty';

const levelFromEnv = (raw?: string): string => {
  // Support numeric and string levels; default to 'info'
  const map: Record<number, string> = {
    0: 'trace',
    1: 'trace',
    2: 'debug',
    3: 'info',
    4: 'warn',
    5: 'error',
    6: 'fatal',
  };
  if (raw && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return map[n] ?? 'info';
  }
  return (raw?.toLowerCase() as LoggerOptions['level']) || 'info';
};

const isJsonFormat = () => process.env.LOG_FORMAT === 'json';

const prettyOptions = {
  colorize: true,
  singleLine: true,
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l o',
  ignore: 'pid,hostname',
} as const;

export const createLogger = (name: string) => {
  const pinoLevel = levelFromEnv(process.env.LOG_LEVEL);
  const baseOptions: LoggerOptions = {
    level: pinoLevel,
    base: { name }
  };

  if (!isJsonFormat()) {
    const prettyStream = pretty(prettyOptions);
    return pino(baseOptions, prettyStream);
  }
  return pino(baseOptions);
};

export const createFastifyLogger = (name = 'Fastify') => {
  const pinoLevel = levelFromEnv(process.env.LOG_LEVEL);
  if (isJsonFormat()) {
    return {
      level: pinoLevel,
      base: { name }
    };
  }
  return {
    level: pinoLevel,
    base: { name },
    transport: {
      target: 'pino-pretty',
      options: prettyOptions,
    }
  };
};
