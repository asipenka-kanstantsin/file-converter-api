import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';

import { LocalStorage } from './local.storage';
import { mapStorageException } from './storage-exception.mapper';
import { StorageUnavailableError } from './storage.port';

describe('LocalStorage', () => {
  let root: string;
  let storage: LocalStorage;
  const key = `avatar/${randomUUID()}/${randomUUID()}`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storage-'));
    storage = new LocalStorage(root);
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('puts, streams back with its content type, and deletes idempotently', async () => {
    await storage.putObject(key, Buffer.from('hello'), {
      contentType: 'image/png',
    });

    const object = await storage.getObject(key);
    expect(object?.contentType).toBe('image/png');
    expect(object?.size).toBe(5);
    expect(object ? await text(object.body) : undefined).toBe('hello');

    await storage.deleteObject(key);
    await storage.deleteObject(key);
    expect(await storage.getObject(key)).toBeNull();
  });

  it('refuses keys that are not server-generated or would leave the root', async () => {
    for (const bad of [
      '../etc/passwd',
      '/abs/path',
      'avatar/x/../../y',
      'avatar',
    ]) {
      await expect(storage.getObject(bad)).rejects.toThrow(
        /invalid storage key/,
      );
    }
  });

  it('reports a broken backend as StorageUnavailableError, mapped to 500', async () => {
    const blocked = new LocalStorage(join(root, 'file-not-dir'));
    await storage.putObject(key, Buffer.from('x'), {
      contentType: 'text/plain',
    });
    // The root of `blocked` sits below a regular file: every write fails.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'file-not-dir'), 'x');

    const error = await blocked
      .putObject(key, Buffer.from('x'), { contentType: 'text/plain' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(mapStorageException(error)).toEqual({
      code: 'STORAGE_UNAVAILABLE',
      status: 500,
    });
    expect(mapStorageException(new Error('other'))).toBeUndefined();
  });
});
