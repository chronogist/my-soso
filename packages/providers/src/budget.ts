/**
 * Tracks monthly upstream-provider call usage. The composer asks
 * `acquire(n)` before issuing a real upstream call; if the budget
 * has room it records `n` calls and returns true. `recordUsage` is
 * exposed so callers can reconcile after the fact (e.g. when an
 * upstream call succeeds but counts as more than 1 unit).
 */
export interface BudgetTracker {
  /** Reserve `count` calls atomically. Returns false when exhausted. */
  acquire: (count: number) => Promise<boolean>;
  /** Read current usage without mutating. */
  snapshot: () => Promise<BudgetSnapshot>;
}

export interface BudgetSnapshot {
  provider: string;
  periodStart: Date;
  callsUsed: number;
  callsLimit: number;
  /** True if usage has crossed the warn threshold (default 70%). */
  warnTripped: boolean;
  /** True if usage has crossed the hard-stop threshold (default 95%). */
  hardStopTripped: boolean;
}
