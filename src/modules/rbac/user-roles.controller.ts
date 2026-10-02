import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '@/common/decorators';

import {
  UserIdParamDto,
  UserRolesDto,
  UserRolesInputDto,
} from './dto/rbac.dto';
import { RbacAdminService } from './rbac-admin.service';

interface UserRoles {
  roleIds: string[];
  userId: string;
}

// Decision R8: which roles a user holds (the implicit `user` role is not listed). Notion names a
// user as "носитель одной или нескольких ролей" but gives no endpoint; this fills the gap.
@Controller('admin/users/:userId/roles')
@RequirePermission('rbac', 'manage')
export class UserRolesController {
  constructor(private readonly admin: RbacAdminService) {}

  @Get()
  @ZodSerializerDto(UserRolesDto)
  async get(@Param() { userId }: UserIdParamDto): Promise<UserRoles> {
    return { roleIds: await this.admin.userRoles(userId), userId };
  }

  @Put()
  @ZodSerializerDto(UserRolesDto)
  async replace(
    @CurrentUser() actor: AuthUser,
    @Param() { userId }: UserIdParamDto,
    @Body() { roleIds }: UserRolesInputDto,
  ): Promise<UserRoles> {
    return {
      roleIds: await this.admin.setUserRoles(actor, userId, roleIds),
      userId,
    };
  }
}
