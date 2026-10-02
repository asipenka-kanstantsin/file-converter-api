import { Controller, Get, Header, HttpStatus } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';

import { type AuthUser, CurrentUser } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';

import { UserEnvelopeDto, type UserResponse } from './dto/user-response.dto';
import { toUserResponse } from './users.mapper';
import { UsersService } from './users.service';

// Decision A20: who is signed in, for a client that has only its cookies (e.g. after a reload).
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ZodSerializerDto(UserEnvelopeDto)
  async me(@CurrentUser() actor: AuthUser): Promise<{ user: UserResponse }> {
    const user = await this.users.findById(actor.id);
    // Deleted between the guard and here.
    if (!user) {
      throw new AppException(
        ErrorCode.AUTH_UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
      );
    }
    return { user: toUserResponse(user) };
  }
}
