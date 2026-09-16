// ============================================================
// Logger — Structured logging with levels
// ============================================================

export const enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

const LEVEL_NAMES: Record<number, string> = {
  [LogLevel.DEBUG]: 'DBG',
  [LogLevel.INFO]: 'INF',
  [LogLevel.WARN]: 'WRN',
  [LogLevel.ERROR]: 'ERR',
};

const LEVEL_COLORS: Record<number, string> = {
  [LogLevel.DEBUG]: '\x1b[90m',   // gray
  [LogLevel.INFO]: '\x1b[36m',    // cyan
  [LogLevel.WARN]: '\x1b[33m',    // yellow
  [LogLevel.ERROR]: '\x1b[31m',   // red
};

const RESET = '\x1b[0m';

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private component: string = '';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setComponent(name: string): void {
    this.component = name;
  }

  child(component: string): Logger {
    const child = new Logger();
    child.level = this.level;
    child.component = component;
    return child;
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, msg, data);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (level < this.level) return;

    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const color = LEVEL_COLORS[level] || '';
    const levelName = LEVEL_NAMES[level] || '???';
    const comp = this.component ? `[${this.component}]` : '';

    let line = `${color}${ts} ${levelName}${RESET} ${comp} ${msg}`;
    if (data) {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(data)) {
        parts.push(`${k}=${typeof v === 'number' ? v.toFixed(2) : v}`);
      }
      line += ` ${'\x1b[90m'}${parts.join(' ')}${RESET}`;
    }

    if (level >= LogLevel.ERROR) {
      console.error(line);
    } else if (level >= LogLevel.WARN) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  /** Log a timing measurement */
  time(label: string, startMs: number): void {
    const elapsed = Date.now() - startMs;
    this.debug(`${label} took ${elapsed}ms`);
  }
}

export const logger = new Logger();

// Parse log level from env
const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
switch (envLevel) {
  case 'debug': logger.setLevel(LogLevel.DEBUG); break;
  case 'warn': logger.setLevel(LogLevel.WARN); break;
  case 'error': logger.setLevel(LogLevel.ERROR); break;
  case 'none': logger.setLevel(LogLevel.NONE); break;
  default: logger.setLevel(LogLevel.INFO);
}
