import type { Readable } from 'node:stream';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';
import { FilesService } from '@/modules/files';
import { UsersService } from '@/modules/users';

import { TransformationsRepository } from './transformations.repository';

export interface SavedResult {
  body: Readable;
  filename: string;
  mime: string;
  size: number;
}

interface Audit {
  actorUserId: string;
  fileId?: string;
  ownerUserId?: string;
  targetUserId: string;
  transformationId: string;
}

// Names are server-made (`converted.<ext>`, F10); anything else falls back to a fixed name, so a
// header never carries a quote or a control character.
const SAFE_NAME = /^[\w.-]{1,100}$/;

// Notion "Сохранение результатов" 1.3.2/1.3.3 (decision F13): a saved result streamed through the
// API after the checks, never a storage URL. Audit (1.5): actor, owner, transformation, file,
// action download, result, size, duration — never the content.
@Injectable()
export class DownloadsService {
  private readonly logger = new Logger(DownloadsService.name);

  constructor(
    private readonly files: FilesService,
    private readonly repository: TransformationsRepository,
    private readonly users: UsersService,
  ) {}

  // Self: someone else's item is 403 (Notion), an unknown one 404.
  own(actor: AuthUser, itemId: string): Promise<SavedResult> {
    return this.open(
      {
        actorUserId: actor.id,
        targetUserId: actor.id,
        transformationId: itemId,
      },
      (owner) => {
        if (owner !== actor.id) {
          throw new AppException(
            ErrorCode.AUTH_FORBIDDEN,
            HttpStatus.FORBIDDEN,
          );
        }
      },
    );
  }

  // transformations@download: the user must exist and own the item, else 404.
  ofUser(
    actor: AuthUser,
    userId: string,
    itemId: string,
  ): Promise<SavedResult> {
    const audit = {
      actorUserId: actor.id,
      targetUserId: userId,
      transformationId: itemId,
    };
    return this.open(
      audit,
      (owner) => {
        if (owner !== userId) {
          throw new AppException(
            ErrorCode.TRANSFORMATION_NOT_FOUND,
            HttpStatus.NOT_FOUND,
          );
        }
      },
      async () => {
        if (!(await this.users.findById(userId))) {
          throw new AppException(
            ErrorCode.USER_NOT_FOUND,
            HttpStatus.NOT_FOUND,
          );
        }
      },
    );
  }

  private async open(
    audit: Audit,
    checkOwner: (owner: string) => void,
    checkUser?: () => Promise<void>,
  ): Promise<SavedResult> {
    const started = Date.now();
    try {
      await checkUser?.();
      const row = await this.repository.findForDownload(audit.transformationId);
      if (!row) {
        throw new AppException(
          ErrorCode.TRANSFORMATION_NOT_FOUND,
          HttpStatus.NOT_FOUND,
        );
      }
      // The owner, also when the actor is refused: an attempt on another's item is traceable.
      audit.ownerUserId = row.userId;
      checkOwner(row.userId);
      // Expired but not yet cleaned up (F5): gone, as it will be within the hour.
      if (row.expiresAt.getTime() <= Date.now()) {
        throw new AppException(ErrorCode.RESULT_EXPIRED, HttpStatus.GONE);
      }
      if (row.resultFileId === null) {
        throw new AppException(
          ErrorCode.RESULT_NOT_FOUND,
          HttpStatus.NOT_FOUND,
        );
      }
      audit.fileId = row.resultFileId;
      // A row without its object (a desync, logged by FilesService) is "file missing": 404.
      const stored = await this.files.open(row.resultFileId);
      if (!stored) {
        throw new AppException(
          ErrorCode.RESULT_NOT_FOUND,
          HttpStatus.NOT_FOUND,
        );
      }
      const { body, file } = stored;
      // Logged once the body is sent or the transfer is cut, with its duration.
      body.once('close', () => {
        this.log(audit, {
          durationMs: Date.now() - started,
          fileSize: file.size,
          result: body.readableEnded ? HttpStatus.OK : 'aborted',
        });
      });
      return {
        body,
        filename:
          file.originalName !== null && SAFE_NAME.test(file.originalName)
            ? file.originalName
            : 'result',
        mime: file.mime,
        size: file.size,
      };
    } catch (error: unknown) {
      this.log(audit, {
        durationMs: Date.now() - started,
        result:
          error instanceof AppException
            ? error.status
            : HttpStatus.INTERNAL_SERVER_ERROR,
      });
      throw error;
    }
  }

  private log(
    audit: Audit,
    outcome: { durationMs: number; fileSize?: number; result: number | string },
  ): void {
    this.logger.log(
      { action: 'download', ...audit, ...outcome },
      'result download',
    );
  }
}
