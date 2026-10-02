import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';
import { UsersService } from '@/modules/users';

import type { HistoryItem, HistoryQuery } from './history';
import { TransformationsRepository } from './transformations.repository';

export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: null | string;
}

// Notion "Просмотр истории трансформаций": Self sees only its own rows (the user id comes from
// the token, never from the request); an admin with transformations@history sees one user's.
// Audit (1.5): actor, target, parameters without PII, result, count — never file content.
@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    private readonly repository: TransformationsRepository,
    private readonly users: UsersService,
  ) {}

  own(actor: AuthUser, query: HistoryQuery): Promise<HistoryPage> {
    return this.list(actor, actor.id, query);
  }

  ofUser(
    actor: AuthUser,
    userId: string,
    query: HistoryQuery,
  ): Promise<HistoryPage> {
    return this.list(actor, userId, query, async () => {
      if (!(await this.users.findById(userId))) {
        throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND);
      }
    });
  }

  // Every outcome is audited: an unknown user, a refused cursor or a failure too.
  private async list(
    actor: AuthUser,
    userId: string,
    query: HistoryQuery,
    check?: () => Promise<void>,
  ): Promise<HistoryPage> {
    let page: HistoryPage;
    try {
      await check?.();
      page = await this.repository.list(userId, query);
    } catch (error: unknown) {
      this.audit(
        actor,
        userId,
        query,
        error instanceof AppException
          ? error.status
          : HttpStatus.INTERNAL_SERVER_ERROR,
        0,
      );
      throw error;
    }
    this.audit(actor, userId, query, HttpStatus.OK, page.items.length);
    return page;
  }

  private audit(
    actor: AuthUser,
    targetUserId: string,
    query: HistoryQuery,
    result: number,
    count: number,
  ): void {
    const { cursor, ...filters } = query;
    this.logger.log(
      {
        actorUserId: actor.id,
        count,
        cursor: cursor !== undefined,
        ...filters,
        result,
        targetUserId,
      },
      'history viewed',
    );
  }
}
