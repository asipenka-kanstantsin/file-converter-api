import { Module } from '@nestjs/common';

import { UsersModule } from '@/modules/users';

import { PermissionGuard } from './permission.guard';
import { RbacAdminController } from './rbac-admin.controller';
import { RbacAdminService } from './rbac-admin.service';
import { RbacRepository } from './rbac.repository';
import { RbacService } from './rbac.service';
import { UserRolesController } from './user-roles.controller';

@Module({
  controllers: [RbacAdminController, UserRolesController],
  // AppModule registers the guard globally, after JwtAuthGuard (03-nestjs).
  exports: [PermissionGuard, RbacAdminService, RbacService],
  imports: [UsersModule],
  providers: [PermissionGuard, RbacAdminService, RbacRepository, RbacService],
})
export class RbacModule {}
