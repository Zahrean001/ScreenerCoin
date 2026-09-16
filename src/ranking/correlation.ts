import { ScreenerCandidate } from '../data/types.js';
import { CONFIG } from '../config.js';

export class CorrelationFilter {
  constructor() {}

  applyPenalty(candidates: ScreenerCandidate[], sectorMap: Map<string, string>): ScreenerCandidate[] {
    // Sort descending by finalScore initially
    candidates.sort((a, b) => b.finalScore - a.finalScore);

    const counts = new Map<string, number>();

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      // Note: Skip index 0 to guarantee top rank is unaffected if desired,
      // but logic requires checking starting from rank 2 (index 1).
      
      let sector = sectorMap.get(cand.symbol);
      if (!sector) {
        const baseCoin = cand.symbol.replace(/USDT$/, '');
        sector = sectorMap.get(baseCoin) || 'OTHER';
      }
      
      const key = `${sector}-${cand.side}`;
      const currentCount = counts.get(key) || 0;

      if (currentCount >= CONFIG.MAX_SAME_SECTOR_IN_TOP && i > 0) {
        cand.finalScore *= (1 - CONFIG.CORRELATION_PENALTY_FACTOR);
        cand.reasons.push('Sector correlation penalty');
      }

      counts.set(key, currentCount + 1);
    }

    // Re-sort after applying penalties
    candidates.sort((a, b) => b.finalScore - a.finalScore);
    return candidates;
  }
}
