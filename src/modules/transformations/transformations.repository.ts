import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Injectable } from '@nestjs/common';

import type { PrismaService } from '@/infrastructure/database';

import type { TransformationType } from './converter';

export interface NewTransformation {
  durationMs: number;
  errorCode: null | string;
  expiresAt: Date;
  fileSize: number;
  sourceFormat: null | string;
  status: 'error' | 'success';
  targetFormat: string;
  type: TransformationType;
  userId: string;
}

@Injectable()
export class TransformationsRepository {
  constructor(
    private readonly txHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  async create(input: NewTransformation): Promise<string> {
    const row = await this.txHost.tx.transformation.create({
      data: input,
      select: { id: true },
    });
    return row.id;
  }

  async setResult(id: string, fileId: string): Promise<void> {
    await this.txHost.tx.transformation.update({
      data: { resultFileId: fileId },
      where: { id },
    });
  }

  // Account deletion (D1): the user's history goes; saved results are removed as files.
  async deleteForUser(userId: string): Promise<void> {
    await this.txHost.tx.transformation.deleteMany({ where: { userId } });
  }
}
