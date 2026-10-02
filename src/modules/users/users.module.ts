import { Module } from '@nestjs/common';

import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  exports: [UsersService],
  providers: [UsersRepository, UsersService],
})
export class UsersModule {}
