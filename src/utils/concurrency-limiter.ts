// ============================================================
// Concurrency Limiter, Rate Limiter, and Circuit Breaker
// ============================================================

export class ConcurrencyLimiter {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(public readonly maxConcurrent: number = 5) {
    if (maxConcurrent < 1) throw new Error('maxConcurrent must be at least 1');
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    public readonly tokensPerSecond: number = 10,
    public readonly maxTokens: number = 10
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    const addedTokens = elapsedSeconds * this.tokensPerSecond;
    this.tokens = Math.min(this.maxTokens, this.tokens + addedTokens);
    this.lastRefill = now;
  }

  async acquire(cost: number = 1): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      const needed = cost - this.tokens;
      const waitMs = Math.ceil((needed / this.tokensPerSecond) * 1000);
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, waitMs)));
    }
  }
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastStateChange: number = 0;

  constructor(
    public readonly failureThreshold: number = 5,
    public readonly cooldownMs: number = 45_000
  ) {}

  isOpen(): boolean {
    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.lastStateChange >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = now;
        return false; // allow a probe request
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === 'HALF_OPEN' || this.state === 'OPEN') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
    }
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
    }
  }

  getState(): CircuitState {
    this.isOpen(); // trigger potential transition to HALF_OPEN
    return this.state;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastStateChange = Date.now();
  }
}
