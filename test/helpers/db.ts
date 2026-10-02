import type { NestExpressApplication } from '@nestjs/platform-express';

import { PrismaService } from '@/infrastructure/database';
import type { FlagKey } from '@/modules/settings';

export function prismaOf(app: NestExpressApplication): PrismaService {
  return app.get(PrismaService);
}

// Every table except the migrations table; e2e suites run serially (--runInBand).
export async function resetDatabase(
  app: NestExpressApplication,
): Promise<void> {
  await prismaOf(app).$executeRaw`
    TRUNCATE TABLE challenges, users, app_settings, outbox_messages RESTART IDENTITY CASCADE`;
}

export async function setFlag(
  app: NestExpressApplication,
  key: FlagKey,
  value: boolean,
): Promise<void> {
  await prismaOf(app).appSetting.upsert({
    create: { key, value },
    update: { value },
    where: { key },
  });
}
