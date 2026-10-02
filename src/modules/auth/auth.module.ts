import { Module } from '@nestjs/common';

import { MailModule } from '@/infrastructure/mail';
import { SettingsModule } from '@/modules/settings';
import { UsersModule } from '@/modules/users';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ChallengesRepository } from './challenges.repository';
import { ChallengesService } from './challenges.service';
import { PasswordHasher } from './password-hasher';

@Module({
  controllers: [AuthController],
  imports: [MailModule, SettingsModule, UsersModule],
  providers: [
    AuthService,
    ChallengesRepository,
    ChallengesService,
    PasswordHasher,
  ],
})
export class AuthModule {}
