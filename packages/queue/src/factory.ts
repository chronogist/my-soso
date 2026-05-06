import { Queue, Worker, QueueEvents, type Processor, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';

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
