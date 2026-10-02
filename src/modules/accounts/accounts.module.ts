import { Module, type OnModuleInit } from '@nestjs/common';

import { AuthModule, ConfirmationHandlers } from '@/modules/auth';
import { FilesModule } from '@/modules/files';
import { RbacModule } from '@/modules/rbac';
import { TransformationsModule } from '@/modules/transformations';
import { UsersModule } from '@/modules/users';

import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AdminUsersController } from './admin-users.controller';

// User-facing operations on one account (view, change, delete) that need both the users and
// the RBAC modules; kept apart so neither of those depends on the other.
@Module({
  controllers: [AccountsController, AdminUsersController],
  imports: [
    AuthModule,
    FilesModule,
    RbacModule,
    TransformationsModule,
    UsersModule,
  ],
  providers: [AccountsService],
})
export class AccountsModule implements OnModuleInit {
  constructor(
    private readonly accounts: AccountsService,
    private readonly handlers: ConfirmationHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('account_deletion', {
      complete: (userId) => this.accounts.completeDeletion(userId),
      completed: (userId) => {
        this.accounts.auditSelfDeletion(userId);
      },
      lock: (userId) => this.accounts.lockForDeletion(userId),
    });
  }
}
