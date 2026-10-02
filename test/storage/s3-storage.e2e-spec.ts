import { randomUUID } from 'node:crypto';
import { text } from 'node:stream/consumers';

import { loadAppConfig } from '@/config';
import { S3Storage, StorageUnavailableError } from '@/infrastructure/storage';

// The S3 adapter against the compose SeaweedFS (bucket app-test), 12-storage → Testing.
describe('S3Storage (SeaweedFS)', () => {
  const config = loadAppConfig().storage.s3;
  const storage = new S3Storage(config);
  const key = `avatar/${randomUUID()}/${randomUUID()}`;

  afterAll(() => {
    storage.destroy();
  });

  it('puts, streams back, deletes, and treats a missing key as absent', async () => {
    await storage.putObject(key, Buffer.from('hello'), {
      contentType: 'text/plain',
    });

    const object = await storage.getObject(key);
    expect(object?.contentType).toBe('text/plain');
    expect(object?.size).toBe(5);
    expect(object ? await text(object.body) : undefined).toBe('hello');

    await storage.deleteObject(key);
    await storage.deleteObject(key);
    expect(await storage.getObject(key)).toBeNull();
  });

  it('reports an unreachable backend as StorageUnavailableError', async () => {
    const broken = new S3Storage({ ...config, endpoint: 'http://127.0.0.1:1' });

    await expect(broken.getObject(key)).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
    broken.destroy();
  });
});
