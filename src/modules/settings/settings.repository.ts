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

  async findValue(key: string): Promise<unknown> {
    const row = await this.txHost.tx.appSetting.findUnique({
      select: { value: true },
      where: { key },
    });
    return row?.value;
  }
}
