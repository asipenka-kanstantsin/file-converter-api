import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  type AuthenticatedRequest,
  PERMISSION_KEY,
  type RequiredPermission,
} from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';

import { RbacService } from './rbac.service';

// Global, after JwtAuthGuard (03-nestjs): a route with @RequirePermission() proceeds only when
// one of the caller's roles holds that permission and action (Notion "RBAC" 1.3.1), else 403.
// Routes without it are open to any authenticated user; ownership is the service's job.
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<
      RequiredPermission | undefined
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { user } = request;
    // A permission on a @Public() route is a wiring mistake: fail closed.
    if (!user) {
      throw new AppException(
        ErrorCode.AUTH_UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (this.rbac.can(user.roleIds, required.permission, required.action)) {
      return true;
    }
    // Notion "RBAC" 1.5: actor, operation and result.
    this.logger.warn(
      {
        action: required.action,
        actorUserId: user.id,
        method: request.method,
        path: request.path,
        permission: required.permission,
        result: HttpStatus.FORBIDDEN,
      },
      'permission denied',
    );
    throw new AppException(ErrorCode.AUTH_FORBIDDEN, HttpStatus.FORBIDDEN);
  }
}
