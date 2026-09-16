// ============================================================
// Validation Framework — Signal Quality & Accuracy Metrics
// ============================================================

import fs from 'node:fs';
import { ScreenerCandidate, MarketRegime } from '../data/types.js';

export interface LoggedSignal {
  timestamp: string;
  candidate: ScreenerCandidate;
  regime: MarketRegime;
  loggedAt: number;
}

export interface MetricEvaluation {
  totalSignals: number;
  longSignals: number;
  shortSignals: number;
  averageScore: number;
  averageExecutionScore: number;
  hitRateEstimate?: number;
  distributionByRating: Record<string, number>;
  distributionByTier: Record<string, number>;
}

export class SignalValidator {
  constructor(private logFilePath: string = './validation/signal-log.jsonl') {}

  loadSignals(): LoggedSignal[] {
    if (!fs.existsSync(this.logFilePath)) {
      return [];
    }

    const content = fs.readFileSync(this.logFilePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const signals: LoggedSignal[] = [];

    for (const line of lines) {
      try {
        signals.push(JSON.parse(line));
      } catch (err) {
        // Skip invalid line
      }
    }

    return signals;
  }

  evaluateMetrics(): MetricEvaluation {
    const signals = this.loadSignals();
    const evaluation: MetricEvaluation = {
      totalSignals: signals.length,
      longSignals: 0,
      shortSignals: 0,
      averageScore: 0,
      averageExecutionScore: 0,
      distributionByRating: { 'A+': 0, 'A': 0, 'B+': 0, 'WATCH': 0 },
      distributionByTier: { 'A': 0, 'B': 0, 'C': 0, 'D': 0 }
    };

    if (signals.length === 0) return evaluation;

    let scoreSum = 0;
    let execScoreSum = 0;

    for (const sig of signals) {
      if (sig.candidate.side === 'LONG') evaluation.longSignals++;
      else if (sig.candidate.side === 'SHORT') evaluation.shortSignals++;

      scoreSum += sig.candidate.finalScore;
      execScoreSum += sig.candidate.executionScore;

      const rating = sig.candidate.rating;
      if (evaluation.distributionByRating[rating] !== undefined) {
        evaluation.distributionByRating[rating]++;
      }

      const tier = sig.candidate.liquidityTier;
      if (evaluation.distributionByTier[tier] !== undefined) {
        evaluation.distributionByTier[tier]++;
      }
    }

    evaluation.averageScore = scoreSum / signals.length;
    evaluation.averageExecutionScore = execScoreSum / signals.length;

    return evaluation;
  }
}
