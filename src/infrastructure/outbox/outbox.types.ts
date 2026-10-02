export interface OutboxMessageInput {
  idempotencyKey?: string;
  payload: Readonly<Record<string, unknown>>;
  type: string;
}

export type OutboxHandler = (payload: unknown) => Promise<void>;

// A failure a retry cannot fix (invalid payload, rejected recipient): the message goes dead.
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
