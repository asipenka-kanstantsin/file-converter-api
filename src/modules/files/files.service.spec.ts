import type { TransactionHost } from '@nestjs-cls/transactional';

import type { OutboxService } from '@/infrastructure/outbox';

import { FilesService } from './files.service';

function setup(change: () => Promise<unknown>): {
  deleteObject: jest.Mock;
  putObject: jest.Mock;
  run: () => Promise<unknown>;
} {
  const putObject = jest.fn().mockResolvedValue(undefined);
  const deleteObject = jest.fn().mockResolvedValue(undefined);
  const create = jest.fn((args: { data: object }) =>
    Promise.resolve(args.data),
  );
  const txHost = {
    tx: { file: { create } },
    withTransaction: (fn: () => Promise<unknown>) => fn(),
  } as unknown as TransactionHost;
  const service = new FilesService(
    {} as OutboxService,
    { deleteObject, getObject: jest.fn(), putObject },
    txHost,
  );
  return {
    deleteObject,
    putObject,
    run: () =>
      service.storeWithin(
        {
          body: Buffer.from('x'),
          mime: 'image/png',
          ownerId: '00000000-0000-4000-8000-000000000001',
          purpose: 'avatar',
        },
        change,
      ),
  };
}

describe('FilesService.storeWithin', () => {
  it('removes the object again when the change after the put fails', async () => {
    const failure = new Error('link failed');
    const { deleteObject, putObject, run } = setup(() =>
      Promise.reject(failure),
    );

    await expect(run()).rejects.toBe(failure);
    expect(putObject).toHaveBeenCalledTimes(1);
    const [key] = putObject.mock.calls[0] as [string];
    expect(key).toMatch(/^avatar\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    expect(deleteObject).toHaveBeenCalledWith(key);
  });

  it('keeps the object when the change commits', async () => {
    const { deleteObject, run } = setup(() => Promise.resolve('ok'));

    await expect(run()).resolves.toBe('ok');
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
