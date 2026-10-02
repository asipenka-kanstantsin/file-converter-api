import { Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/decorators';
import { ErrorCode } from '@/common/errors';
import type { UsersService } from '@/modules/users';

import { historyQuerySchema } from './history';
import { HistoryService } from './history.service';
import type { TransformationsRepository } from './transformations.repository';

const ACTOR = { id: 'a' } as AuthUser;

describe('HistoryService audit', () => {
  let log: jest.SpyInstance;
  let list: jest.Mock;
  let findById: jest.Mock;
  let service: HistoryService;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    list = jest.fn().mockResolvedValue({ items: [{}, {}], nextCursor: null });
    findById = jest.fn().mockResolvedValue({ id: 'u' });
    service = new HistoryService(
      { list } as unknown as TransformationsRepository,
      { findById } as unknown as UsersService,
    );
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('logs the filters, whether a cursor was given and the count, never the cursor', async () => {
    const query = historyQuerySchema.parse({ cursor: 'secret', type: 'file' });

    await service.ofUser(ACTOR, 'u', query);

    expect(log).toHaveBeenCalledWith(
      {
        actorUserId: 'a',
        count: 2,
        cursor: true,
        limit: 20,
        result: 200,
        targetUserId: 'u',
        type: 'file',
      },
      'history viewed',
    );
  });

  it('logs a refusal with its status', async () => {
    findById.mockResolvedValue(null);
    const query = historyQuerySchema.parse({});

    await expect(service.ofUser(ACTOR, 'u', query)).rejects.toMatchObject({
      code: ErrorCode.USER_NOT_FOUND,
    });
    expect(list).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ count: 0, result: 404 }),
      'history viewed',
    );
  });

  it('logs a failure as 500', async () => {
    list.mockRejectedValue(new Error('db down'));

    await expect(
      service.own(ACTOR, historyQuerySchema.parse({})),
    ).rejects.toThrow('db down');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ result: 500, targetUserId: 'a' }),
      'history viewed',
    );
  });
});
