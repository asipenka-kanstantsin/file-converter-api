import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';

import { AppException, ErrorCode } from '@/common/errors';
import { emailSchema } from '@/common/validation';
import { AppConfigModule } from '@/config';
import { DatabaseModule, PrismaService } from '@/infrastructure/database';
import { RbacAdminService, RbacModule } from '@/modules/rbac';

// Decision R7: the first admin. The account registers as usual; then, on the server:
//   npm run admin:grant -- <email>
// Idempotent. Further admins are assigned through PUT /api/admin/users/{userId}/roles.
@Module({
  imports: [
    AppConfigModule,
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
    RbacModule,
  ],
})
class GrantAdminModule {}

async function main(): Promise<void> {
  const logger = new Logger('grant-admin');
  const email = emailSchema.safeParse(process.argv[2]);
  if (!email.success) {
    logger.error('usage: npm run admin:grant -- <email>');
    process.exitCode = 2;
    return;
  }
  const app = await NestFactory.createApplicationContext(GrantAdminModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const userId = await app
      .get(RbacAdminService)
      .grantAdminByEmail(email.data);
    logger.log(`admin role granted to user ${userId}`);
  } catch (error: unknown) {
    logger.error(
      error instanceof AppException && error.code === ErrorCode.USER_NOT_FOUND
        ? `no account with this e-mail; register it first`
        : error instanceof Error
          ? error.message
          : String(error),
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('grant-admin').error(error);
  process.exit(1);
});
