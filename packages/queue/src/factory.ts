import { Queue, Worker, QueueEvents, type Processor, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';

export type { Queue, Worker, QueueEvents, Processor, WorkerOptions } from 'bullmq';

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 60 * 60, count: 1000 },
  removeOnFail: { age: 24 * 60 * 60 },
};

export function createQueue<TData>(name: string, connection: Redis): Queue<TData> {
  return new Queue<TData>(name, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
}

export function createQueueEvents(name: string, connection: Redis): QueueEvents {
  return new QueueEvents(name, { connection });
}

export interface CreateWorkerOptions<TData, TResult> {
  name: string;
  connection: Redis;
  processor: Processor<TData, TResult>;
  /** Per-worker concurrency (parallel jobs handled). Default 4. */
  concurrency?: number;
  options?: Partial<WorkerOptions>;
}

/**
 * Create a BullMQ worker that processes jobs from the given queue.
 *
 * `concurrency` controls how many jobs this **single worker instance** may
 * process in parallel. The total cluster-wide parallelism for a queue is
 * `concurrency × number of worker replicas` (each replica gets its own
 * share of concurrent slots). Defaults to 4.
 *
 * Note: `DEFAULT_JOB_OPTS` (retries, backoff, TTL) applies at the **queue**
 * level, not the worker level. The worker honours whatever the queue's
 * `defaultJobOptions` specifies. If a job needs per-job overrides, pass
 * them via BullMQ's `JobOptions` at `queue.add()` time.
 */
export function createWorker<TData, TResult>({
  name,
  connection,
  processor,
  concurrency = 4,
  options = {},
}: CreateWorkerOptions<TData, TResult>): Worker<TData, TResult> {
  return new Worker<TData, TResult>(name, processor, {
    connection,
    concurrency,
    ...options,
  });
}
