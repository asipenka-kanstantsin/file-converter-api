import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  type StoragePort,
  StorageUnavailableError,
  type StoredObject,
} from './storage.port';

const KEY = /^[a-z_]+(\/[0-9a-f-]{36}){2}$/;
const META_SUFFIX = '.type';

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

// Files under one root directory (single instance, Notion: "Локальное хранение"). The content
// type is kept next to the object, as S3 would.
export class LocalStorage implements StoragePort {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async deleteObject(key: string): Promise<void> {
    const path = this.pathOf(key);
    try {
      await rm(path, { force: true });
      await rm(`${path}${META_SUFFIX}`, { force: true });
    } catch (error: unknown) {
      throw new StorageUnavailableError('delete', { cause: error });
    }
  }

  async getObject(key: string): Promise<null | StoredObject> {
    const path = this.pathOf(key);
    try {
      const [info, contentType] = await Promise.all([
        stat(path),
        readFile(`${path}${META_SUFFIX}`, 'utf8'),
      ]);
      return { body: createReadStream(path), contentType, size: info.size };
    } catch (error: unknown) {
      if (isMissing(error)) return null;
      throw new StorageUnavailableError('get', { cause: error });
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    options: { contentType: string },
  ): Promise<void> {
    const path = this.pathOf(key);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      await writeFile(`${path}${META_SUFFIX}`, options.contentType, 'utf8');
    } catch (error: unknown) {
      throw new StorageUnavailableError('put', { cause: error });
    }
  }

  // Keys map to paths under the root only: no `..`, no absolute paths (12-storage).
  private pathOf(key: string): string {
    if (!KEY.test(key)) throw new Error(`invalid storage key: ${key}`);
    const path = join(this.root, key);
    const inside = relative(this.root, path);
    if (inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`storage key escapes the root: ${key}`);
    }
    return path;
  }
}
