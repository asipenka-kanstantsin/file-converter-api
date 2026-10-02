import type { AppConfig } from '@/config';

import { TextConversionPool } from './text-conversion.pool';

const pending: (() => void)[] = [];

jest.mock('piscina', () => ({
  Piscina: class {
    destroy(): Promise<void> {
      return Promise.resolve();
    }

    run(): Promise<Uint8Array> {
      return new Promise((resolve) => {
        pending.push(() => {
          resolve(new Uint8Array([1]));
        });
      });
    }
  },
}));

describe('TextConversionPool', () => {
  it('answers 503 once every thread and its share of the queue are taken, and recovers', async () => {
    const pool = new TextConversionPool({
      conversion: { timeoutMs: 30_000, workers: 1 },
    } as AppConfig);
    const input = new Uint8Array([1]);

    // One running + four waiting for a single thread.
    const accepted = Array.from({ length: 5 }, () =>
      pool.run(input, 'csv', 'json'),
    );
    await expect(pool.run(input, 'csv', 'json')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });

    for (const release of pending.splice(0)) release();
    await Promise.all(accepted);
    const again = pool.run(input, 'csv', 'json');
    for (const release of pending.splice(0)) release();
    await expect(again).resolves.toEqual(new Uint8Array([1]));
    await pool.onModuleDestroy();
  });
});
