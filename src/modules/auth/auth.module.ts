import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { MailModule } from '@/infrastructure/mail';
import { SettingsModule } from '@/modules/settings';
import { UsersModule } from '@/modules/users';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ChallengesRepository } from './challenges.repository';
import { ChallengesService } from './challenges.service';
import { LoginLockout } from './login-lockout';
import { PasswordHasher } from './password-hasher';
import { SessionCookies } from './session-cookies';
import { SessionTokenService } from './session-tokens';

@Module({
  controllers: [AuthController],
  // Secrets are passed per token (access vs refresh), so the module needs no default secret.
  imports: [JwtModule.register({}), MailModule, SettingsModule, UsersModule],
  providers: [
    AuthService,
    ChallengesRepository,
    ChallengesService,
    LoginLockout,
    PasswordHasher,
    SessionCookies,
    SessionTokenService,
  ],
})
export class AuthModule {}
