import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { EXCEPTION_MAPPERS } from '@/common/errors';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { buildLoggerOptions } from '@/common/http/logger.options';
import { AppConfig, AppConfigModule } from '@/config';
import { DatabaseModule, mapPrismaException } from '@/infrastructure/database';
import { HealthModule } from '@/modules/health';
import { OpenApiModule } from '@/modules/openapi';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: buildLoggerOptions,
    }),
    OpenApiModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            limit: config.throttle.limit,
            ttl: config.throttle.ttlSeconds * 1000,
          },
        ],
      }),
    }),
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: EXCEPTION_MAPPERS, useValue: [mapPrismaException] },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
