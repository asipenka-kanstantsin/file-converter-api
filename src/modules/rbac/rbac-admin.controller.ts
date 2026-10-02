import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '@/common/decorators';

import {
  GrantEnvelopeDto,
  GrantIdParamDto,
  GrantInputDto,
  GrantListDto,
  type GrantResponse,
  PermissionEnvelopeDto,
  PermissionIdParamDto,
  PermissionInputDto,
  PermissionListDto,
  type PermissionResponse,
  RoleEnvelopeDto,
  RoleIdParamDto,
  RoleInputDto,
  RoleListDto,
  type RoleResponse,
} from './dto/rbac.dto';
import { RbacAdminService } from './rbac-admin.service';
import {
  toGrantResponse,
  toPermissionResponse,
  toRoleResponse,
} from './rbac.mapper';
import { RbacService } from './rbac.service';
import type { Grant } from './rbac.types';

// Notion "RBAC" 1.3.2–1.3.4: only Admin — that is, a role holding rbac@manage.
@Controller('admin/rbac')
@RequirePermission('rbac', 'manage')
export class RbacAdminController {
  constructor(
    private readonly admin: RbacAdminService,
    private readonly rbac: RbacService,
  ) {}

  // Roles

  @Get('roles')
  @ZodSerializerDto(RoleListDto)
  async listRoles(): Promise<{ items: RoleResponse[] }> {
    const { roles } = await this.admin.list();
    return { items: roles.map(toRoleResponse) };
  }

  @Post('roles')
  @ZodSerializerDto(RoleEnvelopeDto)
  async createRole(
    @CurrentUser() actor: AuthUser,
    @Body() input: RoleInputDto,
  ): Promise<{ role: RoleResponse }> {
    return { role: toRoleResponse(await this.admin.createRole(actor, input)) };
  }

  @Put('roles/:roleId')
  @ZodSerializerDto(RoleEnvelopeDto)
  async updateRole(
    @CurrentUser() actor: AuthUser,
    @Param() { roleId }: RoleIdParamDto,
    @Body() input: RoleInputDto,
  ): Promise<{ role: RoleResponse }> {
    return {
      role: toRoleResponse(await this.admin.updateRole(actor, roleId, input)),
    };
  }

  @Delete('roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRole(
    @CurrentUser() actor: AuthUser,
    @Param() { roleId }: RoleIdParamDto,
  ): Promise<void> {
    await this.admin.deleteRole(actor, roleId);
  }

  // Permissions

  @Get('permissions')
  @ZodSerializerDto(PermissionListDto)
  async listPermissions(): Promise<{ items: PermissionResponse[] }> {
    const { permissions } = await this.admin.list();
    return { items: permissions.map(toPermissionResponse) };
  }

  @Post('permissions')
  @ZodSerializerDto(PermissionEnvelopeDto)
  async createPermission(
    @CurrentUser() actor: AuthUser,
    @Body() input: PermissionInputDto,
  ): Promise<{ permission: PermissionResponse }> {
    return {
      permission: toPermissionResponse(
        await this.admin.createPermission(actor, input),
      ),
    };
  }

  @Put('permissions/:permissionId')
  @ZodSerializerDto(PermissionEnvelopeDto)
  async updatePermission(
    @CurrentUser() actor: AuthUser,
    @Param() { permissionId }: PermissionIdParamDto,
    @Body() input: PermissionInputDto,
  ): Promise<{ permission: PermissionResponse }> {
    return {
      permission: toPermissionResponse(
        await this.admin.updatePermission(actor, permissionId, input),
      ),
    };
  }

  @Delete('permissions/:permissionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePermission(
    @CurrentUser() actor: AuthUser,
    @Param() { permissionId }: PermissionIdParamDto,
  ): Promise<void> {
    await this.admin.deletePermission(actor, permissionId);
  }

  // Grants

  @Get('grants')
  @ZodSerializerDto(GrantListDto)
  async listGrants(): Promise<{ items: GrantResponse[] }> {
    const { grants } = await this.admin.list();
    return { items: grants.map((grant) => this.grantResponse(grant)) };
  }

  @Post('grants')
  @ZodSerializerDto(GrantEnvelopeDto)
  async createGrant(
    @CurrentUser() actor: AuthUser,
    @Body() input: GrantInputDto,
  ): Promise<{ grant: GrantResponse }> {
    return {
      grant: this.grantResponse(await this.admin.createGrant(actor, input)),
    };
  }

  @Put('grants/:grantId')
  @ZodSerializerDto(GrantEnvelopeDto)
  async updateGrant(
    @CurrentUser() actor: AuthUser,
    @Param() { grantId }: GrantIdParamDto,
    @Body() input: GrantInputDto,
  ): Promise<{ grant: GrantResponse }> {
    return {
      grant: this.grantResponse(
        await this.admin.updateGrant(actor, grantId, input),
      ),
    };
  }

  @Delete('grants/:grantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGrant(
    @CurrentUser() actor: AuthUser,
    @Param() { grantId }: GrantIdParamDto,
  ): Promise<void> {
    await this.admin.deleteGrant(actor, grantId);
  }

  private grantResponse(grant: Grant): GrantResponse {
    return toGrantResponse(grant, this.rbac.isProtectedGrant(grant));
  }
}
