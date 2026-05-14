import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const JOB_STATUS = ['success', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

/** BullMQ run history. Retention: 30 days, pruned by housekeeping job. */
export const jobsLog = pgTable(
  'jobs_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    queue: text('queue').notNull(),
    jobName: text('job_name').notNull(),
    jobId: text('job_id').notNull(),
    status: text('status').notNull().$type<JobStatus>(),
    attempts: smallint('attempts').notNull().default(1),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    durationMs: integer('duration_ms'),
    error: text('error'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('jobs_log_queue_finished_idx').on(t.queue, t.finishedAt.desc()),
    index('jobs_log_status_idx').on(t.status),
    check('jobs_log_status_check', sql`${t.status} IN ('success','failed')`),
  ],
);

export type JobLog = typeof jobsLog.$inferSelect;
export type NewJobLog = typeof jobsLog.$inferInsert;
