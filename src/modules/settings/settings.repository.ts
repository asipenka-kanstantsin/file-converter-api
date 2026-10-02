import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Injectable } from '@nestjs/common';

import type { PrismaService } from '@/infrastructure/database';

@Injectable()
export class SettingsRepository {
  constructor(
    private readonly txHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  async findValues(keys: readonly string[]): Promise<Map<string, unknown>> {
    const rows = await this.txHost.tx.appSetting.findMany({
      select: { key: true, value: true },
      where: { key: { in: [...keys] } },
    });
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  async upsertValues(values: Readonly<Record<string, boolean>>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await this.txHost.tx.appSetting.upsert({
        create: { key, value },
        update: { value },
        where: { key },
      });
    }
  }

  async findValue(key: string): Promise<unknown> {
    const row = await this.txHost.tx.appSetting.findUnique({
      select: { value: true },
      where: { key },
    });
    return row?.value;
  }
}
