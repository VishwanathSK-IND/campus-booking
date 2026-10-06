const silent = process.env.NODE_ENV === 'test' && !process.env.DEBUG_LOGS;

function write(level, args) {
  if (silent && level !== 'error') return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(prefix, ...args);
}

export const logger = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
};
