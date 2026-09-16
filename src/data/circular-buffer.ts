// ============================================================
// Circular Buffer — O(1) ring buffer for time-series data
// ============================================================

export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private _size: number = 0;

  constructor(public readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  get size(): number {
    return this._size;
  }

  get isFull(): boolean {
    return this._size === this.capacity;
  }

  /** Get item at index (0 = oldest, size-1 = newest) */
  at(index: number): T | undefined {
    if (index < 0 || index >= this._size) return undefined;
    const actualIndex = (this.head - this._size + index + this.capacity) % this.capacity;
    return this.buffer[actualIndex];
  }

  /** Get the most recent item */
  latest(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  /** Get the oldest item */
  oldest(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buffer[(this.head - this._size + this.capacity) % this.capacity];
  }

  /** Get the N most recent items (newest first) */
  lastN(n: number): T[] {
    const count = Math.min(n, this._size);
    const result: T[] = new Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = this.buffer[(this.head - 1 - i + this.capacity) % this.capacity] as T;
    }
    return result;
  }

  /** Get all items from oldest to newest */
  toArray(): T[] {
    const result: T[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      result[i] = this.buffer[(this.head - this._size + i + this.capacity) % this.capacity] as T;
    }
    return result;
  }

  /** Apply a function to each element (oldest to newest) */
  forEach(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this._size; i++) {
      fn(this.buffer[(this.head - this._size + i + this.capacity) % this.capacity] as T, i);
    }
  }

  /** Reduce over all elements (oldest to newest) */
  reduce<U>(fn: (acc: U, item: T, index: number) => U, initial: U): U {
    let acc = initial;
    for (let i = 0; i < this._size; i++) {
      acc = fn(acc, this.buffer[(this.head - this._size + i + this.capacity) % this.capacity] as T, i);
    }
    return acc;
  }

  clear(): void {
    this.head = 0;
    this._size = 0;
  }
}

/**
 * Fast numeric circular buffer using Float64Array — zero GC pressure.
 * Use for single-dimensional numeric time-series (e.g., prices, volumes).
 */
export class NumericRingBuffer {
  private buffer: Float64Array;
  private head: number = 0;
  private _size: number = 0;

  constructor(public readonly capacity: number) {
    this.buffer = new Float64Array(capacity);
  }

  push(value: number): void {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  get size(): number {
    return this._size;
  }

  latest(): number {
    if (this._size === 0) return NaN;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  at(index: number): number {
    if (index < 0 || index >= this._size) return NaN;
    const actualIndex = (this.head - this._size + index + this.capacity) % this.capacity;
    return this.buffer[actualIndex];
  }

  /** Sum of all values */
  sum(): number {
    let s = 0;
    for (let i = 0; i < this._size; i++) {
      s += this.buffer[(this.head - this._size + i + this.capacity) % this.capacity];
    }
    return s;
  }

  /** Mean of all values */
  mean(): number {
    if (this._size === 0) return NaN;
    return this.sum() / this._size;
  }

  /** Get percentile value (0-100) */
  percentile(p: number): number {
    if (this._size === 0) return NaN;
    const sorted = this.toArray().sort((a, b) => a - b);
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return sorted[idx];
  }

  toArray(): number[] {
    const result: number[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      result[i] = this.buffer[(this.head - this._size + i + this.capacity) % this.capacity];
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this._size = 0;
  }
}

// ============================================================
// Timestamped Time-Series Ring Buffers for Exact Window Analytics
// ============================================================

export interface TimestampedPrice {
  timestamp: number; // ms
  price: number;
}

export interface PriceWindowResult {
  value: number | null; // return percentage (e.g. 0.025 for +2.5%) or null if unavailable
  sourceTimestamp: number;
  referenceTimestamp: number;
  window: '5m' | '15m' | '1h';
  dataPointsAvailable: number;
}

/**
 * Ring buffer storing timestamped price points to compute exact rolling timeframe returns.
 * Uses contiguous Float64Arrays for timestamps and prices (zero GC).
 */
export class TimestampedPriceRingBuffer {
  private timestamps: Float64Array;
  private prices: Float64Array;
  private head: number = 0;
  private _size: number = 0;

  constructor(public readonly capacity: number = 720) { // e.g. 720 points = 12 hours of 1-min updates or 1 hour of 5s ticks
    this.timestamps = new Float64Array(capacity);
    this.prices = new Float64Array(capacity);
  }

  push(timestamp: number, price: number): void {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp) || timestamp <= 0) {
      return; // reject invalid or non-positive points
    }

    // Ignore duplicate or out-of-order timestamp if it's strictly older than latest
    if (this._size > 0) {
      const latestTs = this.timestamps[(this.head - 1 + this.capacity) % this.capacity];
      if (timestamp < latestTs) {
        return; // out of order, drop
      }
      if (timestamp === latestTs) {
        // Update latest price in place
        this.prices[(this.head - 1 + this.capacity) % this.capacity] = price;
        return;
      }
    }

    this.timestamps[this.head] = timestamp;
    this.prices[this.head] = price;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  get size(): number {
    return this._size;
  }

  latest(): TimestampedPrice | null {
    if (this._size === 0) return null;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return {
      timestamp: this.timestamps[idx],
      price: this.prices[idx]
    };
  }

  oldest(): TimestampedPrice | null {
    if (this._size === 0) return null;
    const idx = (this.head - this._size + this.capacity) % this.capacity;
    return {
      timestamp: this.timestamps[idx],
      price: this.prices[idx]
    };
  }

  /**
   * Find observation nearest to targetTimestamp within maxToleranceMs.
   */
  findNearestObservation(targetTimestamp: number, maxToleranceMs: number = 60_000): TimestampedPrice | null {
    if (this._size === 0) return null;

    let bestIdx = -1;
    let minDiff = Infinity;

    for (let i = 0; i < this._size; i++) {
      const actualIdx = (this.head - this._size + i + this.capacity) % this.capacity;
      const ts = this.timestamps[actualIdx];
      const absDiff = Math.abs(targetTimestamp - ts);

      if (absDiff < minDiff) {
        minDiff = absDiff;
        bestIdx = actualIdx;
      }
    }

    if (bestIdx !== -1 && minDiff <= maxToleranceMs) {
      return {
        timestamp: this.timestamps[bestIdx],
        price: this.prices[bestIdx]
      };
    }

    return null;
  }

  /**
   * Calculates actual return over a specified rolling window (e.g. 5 minutes = 300,000ms, 1 hour = 3,600,000ms).
   * Returns explicit metadata and null if insufficient history is recorded.
   */
  getReturnOverWindow(
    windowMs: number,
    currentTimestamp?: number,
    maxToleranceRatio: number = 0.35 // allow up to 35% time tolerance (e.g. for 5m, observation within 3.25m - 6.75m)
  ): PriceWindowResult {
    const windowName: '5m' | '15m' | '1h' = windowMs <= 450_000 ? '5m' : (windowMs <= 1800_000 ? '15m' : '1h');

    if (this._size < 2) {
      return {
        value: null,
        sourceTimestamp: currentTimestamp ?? Date.now(),
        referenceTimestamp: 0,
        window: windowName,
        dataPointsAvailable: this._size
      };
    }

    const latestObs = this.latest();
    if (!latestObs) {
      return {
        value: null,
        sourceTimestamp: 0,
        referenceTimestamp: 0,
        window: windowName,
        dataPointsAvailable: 0
      };
    }

    const currTs = currentTimestamp && currentTimestamp >= latestObs.timestamp ? currentTimestamp : latestObs.timestamp;
    const targetTs = currTs - windowMs;
    const oldestObs = this.oldest();

    // Check if buffer has sufficient elapsed history span
    if (!oldestObs || (currTs - oldestObs.timestamp) < (windowMs * (1 - maxToleranceRatio))) {
      return {
        value: null,
        sourceTimestamp: currTs,
        referenceTimestamp: oldestObs?.timestamp ?? 0,
        window: windowName,
        dataPointsAvailable: this._size
      };
    }

    const maxToleranceMs = windowMs * maxToleranceRatio;
    const refObs = this.findNearestObservation(targetTs, maxToleranceMs);

    if (!refObs || refObs.price <= 0) {
      return {
        value: null,
        sourceTimestamp: currTs,
        referenceTimestamp: 0,
        window: windowName,
        dataPointsAvailable: this._size
      };
    }

    const pct = (latestObs.price - refObs.price) / refObs.price;

    return {
      value: Number.isFinite(pct) ? pct : null,
      sourceTimestamp: currTs,
      referenceTimestamp: refObs.timestamp,
      window: windowName,
      dataPointsAvailable: this._size
    };
  }

  toArray(): TimestampedPrice[] {
    const result: TimestampedPrice[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      const idx = (this.head - this._size + i + this.capacity) % this.capacity;
      result[i] = { timestamp: this.timestamps[idx], price: this.prices[idx] };
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this._size = 0;
  }
}

/**
 * Timestamped ring buffer for recording series of numeric metrics like funding rates.
 */
export class TimestampedNumericRingBuffer {
  private timestamps: Float64Array;
  private values: Float64Array;
  private head: number = 0;
  private _size: number = 0;

  constructor(public readonly capacity: number = 200) {
    this.timestamps = new Float64Array(capacity);
    this.values = new Float64Array(capacity);
  }

  push(timestamp: number, value: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(timestamp) || timestamp <= 0) return;
    if (this._size > 0) {
      const latestIdx = (this.head - 1 + this.capacity) % this.capacity;
      const latestTs = this.timestamps[latestIdx];
      if (timestamp === latestTs) {
        this.values[latestIdx] = value;
        return;
      }
      if (timestamp < latestTs) {
        return; // out of order / older observation, drop
      }
    }
    this.timestamps[this.head] = timestamp;
    this.values[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  clear(): void {
    this.head = 0;
    this._size = 0;
  }

  get size(): number {
    return this._size;
  }

  latest(): { timestamp: number; value: number } | null {
    if (this._size === 0) return null;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return {
      timestamp: this.timestamps[idx],
      value: this.values[idx]
    };
  }

  getValues(): number[] {
    const res: number[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      const idx = (this.head - this._size + i + this.capacity) % this.capacity;
      res[i] = this.values[idx];
    }
    return res;
  }

  /**
   * Computes percentile rank (0-100) of a target value against the buffer history.
   * Returns null if insufficient history (< 3 points).
   */
  percentileRank(targetValue: number): number | null {
    if (this._size < 3) return null;
    const arr = this.getValues().sort((a, b) => a - b);
    let count = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] <= targetValue) count++;
      else break;
    }
    return (count / arr.length) * 100;
  }
}
