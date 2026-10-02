import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';
import { RbacService } from '@/modules/rbac';
import { UsersService } from '@/modules/users';

import { type Profile, toProfile } from './profile.policy';

// Self-or-permission access to one user (Notion "Просмотр данных пользователя"). Ownership is
// decided here, not in a guard (09-auth → Self vs permission).
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly rbac: RbacService,
    private readonly users: UsersService,
  ) {}

  async getProfile(actor: AuthUser, userId: string): Promise<Profile> {
    const isSelf = actor.id === userId;
    const audit = { targetUserId: userId, viewerUserId: actor.id };
    // Without users@read a foreign id is 403 whether it exists or not: no account enumeration,
    // and IDOR is refused before any lookup.
    if (!isSelf && !this.rbac.can(actor.roleIds, 'users', 'read')) {
      this.logger.warn(
        { ...audit, result: HttpStatus.FORBIDDEN },
        'profile view refused',
      );
      throw new AppException(ErrorCode.AUTH_FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const user = await this.users.findById(userId);
    if (!user) {
      this.logger.log(
        { ...audit, result: HttpStatus.NOT_FOUND },
        'profile viewed',
      );
      throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    this.logger.log({ ...audit, result: HttpStatus.OK }, 'profile viewed');
    return toProfile(user, isSelf ? 'self' : 'other');
  }
}
