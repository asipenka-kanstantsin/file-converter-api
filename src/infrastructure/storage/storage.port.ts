import type { Readable } from 'node:stream';

export interface StoredObject {
  body: Readable;
  contentType: string;
  // Unknown when the backend does not report it; then no Content-Length is sent.
  size: number | undefined;
}

// Notion "Хранение файлов": the abstraction hides the backend; swapping it is a config change
// (12-storage). Keys are server-generated (`<purpose>/<ownerId>/<uuid>`), never user input.
export interface StoragePort {
  // Idempotent: a missing object is not an error.
  deleteObject(key: string): Promise<void>;
  // null when the object does not exist.
  getObject(key: string): Promise<null | StoredObject>;
  putObject(
    key: string,
    body: Buffer,
    options: { contentType: string },
  ): Promise<void>;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');

// Any failure of the backend itself; answered 500 STORAGE_UNAVAILABLE (Notion: storage errors
// → 500).
export class StorageUnavailableError extends Error {
  constructor(operation: string, options?: ErrorOptions) {
    super(`storage ${operation} failed`, options);
    this.name = 'StorageUnavailableError';
  }
}
