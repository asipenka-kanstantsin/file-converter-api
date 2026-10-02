import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { EXCEPTION_MAPPERS } from '@/common/errors';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { CsrfGuard } from '@/common/http/csrf';
import { buildLoggerOptions } from '@/common/http/logger.options';
import { buildThrottlers } from '@/common/http/rate-limit';
import { AppConfig, AppConfigModule } from '@/config';
import {
  DatabaseModule,
  mapPrismaException,
  PrismaService,
} from '@/infrastructure/database';
import { MailModule } from '@/infrastructure/mail';
import { OutboxModule } from '@/infrastructure/outbox';
import { mapStorageException, StorageModule } from '@/infrastructure/storage';
import { AccountsModule } from '@/modules/accounts';
import { AuthModule, JwtAuthGuard } from '@/modules/auth';
import { HealthModule } from '@/modules/health';
import { OpenApiModule } from '@/modules/openapi';
import { PermissionGuard, RbacModule } from '@/modules/rbac';
import { SettingsModule } from '@/modules/settings';

@Module({
  imports: [
    AccountsModule,
    AppConfigModule,
    AuthModule,
    ClsModule.forRoot({
      global: true,
      plugins: [
        new ClsPluginTransactional({
          adapter: new TransactionalAdapterPrisma({
            prismaInjectionToken: PrismaService,
          }),
          imports: [DatabaseModule],
        }),
      ],
    }),
    DatabaseModule,
    HealthModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: buildLoggerOptions,
    }),
    MailModule,
    OpenApiModule,
    OutboxModule,
    RbacModule,
    SettingsModule,
    StorageModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: buildThrottlers(config),
      }),
    }),
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    {
      provide: EXCEPTION_MAPPERS,
      useValue: [mapPrismaException, mapStorageException],
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: throttling, CSRF, the access token, then the permission (03-nestjs).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
  ],
})
export class AppModule {}
