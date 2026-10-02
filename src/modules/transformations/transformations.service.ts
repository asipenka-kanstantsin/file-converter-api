import {
  type BeforeApplicationShutdown,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';

import type { AuthUser } from '@/common/decorators';
import { AppException, ErrorCode } from '@/common/errors';
import { FilesService } from '@/modules/files';
import { type NumberSettingKey, SettingsService } from '@/modules/settings';
import { UsersService } from '@/modules/users';

import type { Converter } from './converter';
import { TransformationsRepository } from './transformations.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
// A saved result may be larger than its input (JSON → XML); past this it is not saved (Notion
// "Превышение лимита размера сохраняемых файлов"), the conversion itself still succeeds.
export const SAVE_MAX_BYTES = 50 * 1024 * 1024;
// Background saves at once; beyond it a result is not saved (logged), so memory stays bounded.
const MAX_CONCURRENT_SAVES = 4;

export interface ConversionRequest {
  filename: string | undefined;
  input: Buffer;
  options?: unknown;
  save: boolean;
  target: string;
}

export interface ConversionResult {
  body: Buffer;
  filename: string;
  mime: string;
}

interface Recorded {
  expiresAt: Date;
  id: string;
}

function errorCodeOf(error: unknown): string {
  return error instanceof AppException ? error.code : ErrorCode.INTERNAL_ERROR;
}

function limitKey(format: string): NumberSettingKey {
  return `convert.maxBytes.${format}` as NumberSettingKey;
}

// The one pipeline every converter runs through (template method over Converter): format
// detection, the per-format size limit, the pair check, the conversion, the history row of every
// attempt and the audit line (Notion 1.5: userId, formats, size, result, duration — never the
// content). The whole result exists before the response starts, so an error never yields a
// partial file (Notion 1.6). With save=true the result is stored after the response (F9).
@Injectable()
export class TransformationsService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(TransformationsService.name);
  private readonly saving = new Set<Promise<void>>();

  constructor(
    private readonly files: FilesService,
    private readonly repository: TransformationsRepository,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
  ) {}

  // The largest per-format limit of a converter: what the upload may stream at most before the
  // exact per-format check (12-storage → Upload validation). One settings read.
  async uploadLimit(converter: Converter): Promise<number> {
    const limits = await this.settings.numbers(converter.formats.map(limitKey));
    return Math.max(...Object.values<number>(limits));
  }

  async convert(
    actor: AuthUser,
    converter: Converter,
    request: ConversionRequest,
  ): Promise<ConversionResult> {
    const started = Date.now();
    const base = {
      fileSize: request.input.length,
      targetFormat: request.target,
      type: converter.type,
      userId: actor.id,
    };
    let source: string | undefined;
    try {
      if (request.input.length === 0) {
        throw new AppException(ErrorCode.FILE_EMPTY, HttpStatus.BAD_REQUEST);
      }
      source = converter.detect(request.input, request.filename);
      if (!source) {
        throw new AppException(
          ErrorCode.FILE_TYPE_NOT_SUPPORTED,
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
      const maxBytes = await this.settings.number(limitKey(source));
      if (request.input.length > maxBytes) {
        throw new AppException(
          ErrorCode.FILE_TOO_LARGE,
          HttpStatus.PAYLOAD_TOO_LARGE,
          { format: source, maxBytes },
        );
      }
      if (
        !converter.isFormat(request.target) ||
        !converter.supports(source, request.target)
      ) {
        throw new AppException(
          ErrorCode.CONVERSION_NOT_SUPPORTED,
          HttpStatus.BAD_REQUEST,
          { source, target: request.target },
        );
      }
      const body = await converter.convert(
        request.input,
        source,
        request.target,
        request.options,
      );
      const durationMs = Date.now() - started;
      const recorded = await this.record(
        { ...base, durationMs, sourceFormat: source },
        null,
      );
      this.logger.log(
        {
          ...this.audit(base, source, durationMs),
          result: 'success',
          transformationId: recorded.id,
        },
        'conversion succeeded',
      );
      const extension = converter.extensionOf(request.target);
      const mime = converter.mimeOf(request.target);
      if (request.save) {
        this.saveInBackground(actor.id, recorded, body, mime, extension);
      }
      return { body, filename: `converted.${extension}`, mime };
    } catch (error: unknown) {
      const durationMs = Date.now() - started;
      const code = errorCodeOf(error);
      await this.record(
        { ...base, durationMs, sourceFormat: source ?? null },
        code,
      ).catch((recordError: unknown) => {
        this.logger.error(
          { err: recordError },
          'conversion history not recorded',
        );
      });
      this.logger.warn(
        { ...this.audit(base, source, durationMs), code, result: 'error' },
        'conversion failed',
      );
      throw error;
    }
  }

  // Account deletion (D1), in the caller's transaction; result files go with the user's files.
  async forgetUser(userId: string): Promise<void> {
    await this.repository.deleteForUser(userId);
  }

  // Tests and shutdown: every background save has finished.
  async idle(): Promise<void> {
    await Promise.all([...this.saving]);
  }

  // SIGTERM: saves in flight finish first (before the worker pool and storage go down).
  async beforeApplicationShutdown(): Promise<void> {
    await this.idle();
  }

  private async record(
    fields: {
      durationMs: number;
      fileSize: number;
      sourceFormat: null | string;
      targetFormat: string;
      type: Converter['type'];
      userId: string;
    },
    errorCode: null | string,
  ): Promise<Recorded> {
    const retentionDays = await this.settings.number('history.retentionDays');
    const expiresAt = new Date(Date.now() + retentionDays * DAY_MS);
    const id = await this.repository.create({
      ...fields,
      errorCode,
      expiresAt,
      status: errorCode === null ? 'success' : 'error',
    });
    return { expiresAt, id };
  }

  private audit(
    base: {
      fileSize: number;
      targetFormat: string;
      type: string;
      userId: string;
    },
    source: string | undefined,
    durationMs: number,
  ): Record<string, unknown> {
    return {
      durationMs,
      fileSize: base.fileSize,
      sourceFormat: source,
      targetFormat: base.targetFormat,
      type: base.type,
      userId: base.userId,
    };
  }

  // Notion "Сохранение результатов": never blocks the response; a failure is logged and leaves
  // the history row without a file.
  private saveInBackground(
    userId: string,
    recorded: Recorded,
    body: Buffer,
    mime: string,
    extension: string,
  ): void {
    const audit = {
      action: 'save',
      fileSize: body.length,
      transformationId: recorded.id,
      userId,
    };
    if (this.saving.size >= MAX_CONCURRENT_SAVES) {
      this.logger.warn(
        { ...audit, reason: 'busy', result: 'error' },
        'result not saved',
      );
      return;
    }
    const task = this.saveResult(
      audit,
      recorded,
      body,
      mime,
      extension,
    ).finally(() => {
      this.saving.delete(task);
    });
    this.saving.add(task);
  }

  private async saveResult(
    audit: { fileSize: number; transformationId: string; userId: string },
    recorded: Recorded,
    body: Buffer,
    mime: string,
    extension: string,
  ): Promise<void> {
    const started = Date.now();
    if (body.length > SAVE_MAX_BYTES) {
      this.logger.warn(
        { ...audit, reason: 'too_large', result: 'error' },
        'result not saved',
      );
      return;
    }
    try {
      const fileId = await this.files.storeWithin(
        {
          body,
          // The file lives exactly as long as its history row (Notion: deleted together).
          expiresAt: recorded.expiresAt,
          mime,
          originalName: `converted.${extension}`,
          ownerId: audit.userId,
          purpose: 'transformation_result',
        },
        async (file) => {
          // The owner's row, shared: an account deletion (which holds it for update) either
          // finished before — then nothing is saved — or waits for this save to commit.
          if (!(await this.users.lockForShare(audit.userId))) {
            throw new Error('the account is gone');
          }
          await this.repository.setResult(recorded.id, file.id);
          return file.id;
        },
      );
      this.logger.log(
        {
          ...audit,
          durationMs: Date.now() - started,
          fileId,
          result: 'success',
        },
        'result saved',
      );
    } catch (error: unknown) {
      this.logger.error(
        {
          ...audit,
          durationMs: Date.now() - started,
          err: error,
          result: 'error',
        },
        'result not saved',
      );
    }
  }
}
