/**
 * Monotonic clock abstraction. process.hrtime.bigint() (unlike Date.now())
 * never jumps backwards or forwards due to system clock adjustments, which
 * is what makes it safe as the source of billable call duration. Injectable
 * so tests can control elapsed time deterministically instead of relying on
 * real wall-clock delays.
 */
export interface Clock {
  nowNs(): bigint;
}

export const systemClock: Clock = {
  nowNs: () => process.hrtime.bigint(),
};

export class FakeClock implements Clock {
  private current: bigint;

  constructor(startNs = 0n) {
    this.current = startNs;
  }

  nowNs(): bigint {
    return this.current;
  }

  advanceMs(ms: number): void {
    this.current += BigInt(Math.round(ms)) * 1_000_000n;
  }
}
