import { Module } from '@nestjs/common';

import { RbacModule } from '@/modules/rbac';
import { UsersModule } from '@/modules/users';

import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

// User-facing operations on one account (view, change, delete) that need both the users and
// the RBAC modules; kept apart so neither of those depends on the other.
@Module({
  controllers: [AccountsController],
  imports: [RbacModule, UsersModule],
  providers: [AccountsService],
})
export class AccountsModule {}
