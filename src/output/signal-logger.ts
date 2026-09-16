import { ScreenerCandidate, MarketRegime, ScreenerOutput } from '../data/types.js';
import { CONFIG } from '../config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class SignalLogger {
  private logPath: string;

  constructor(logPath: string = CONFIG.SIGNAL_LOG_PATH) {
    this.logPath = logPath;
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  logSignal(candidate: ScreenerCandidate, regime: MarketRegime): void {
    const entry = {
      timestamp: new Date().toISOString(),
      regime,
      ...candidate
    };
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
  }

  logScanCycle(output: ScreenerOutput): void {
    const entry = {
      type: 'CYCLE_METADATA',
      timestamp: output.timestamp,
      latency: output.scanLatencyMs,
      candidates: output.candidateCount,
      btcPrice: output.btcPrice
    };
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
  }
}
