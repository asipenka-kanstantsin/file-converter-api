import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { OnModuleDestroy } from '@nestjs/common';

import type { AppConfig } from '@/config';

import {
  type StoragePort,
  StorageUnavailableError,
  type StoredObject,
} from './storage.port';

function isNotFound(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404)
  );
}

// Any S3 API: SeaweedFS locally (docker compose), AWS or another provider elsewhere. Objects are
// private; nothing here hands out URLs (decision F4).
export class S3Storage implements OnModuleDestroy, StoragePort {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: AppConfig['storage']['s3']) {
    if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error('S3 storage needs a bucket and credentials');
    }
    this.bucket = config.bucket;
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    });
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error: unknown) {
      if (isNotFound(error)) return;
      throw new StorageUnavailableError('delete', { cause: error });
    }
  }

  async getObject(key: string): Promise<null | StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!(result.Body instanceof Readable)) {
        throw new Error('the S3 body is not a stream');
      }
      return {
        body: result.Body,
        contentType: result.ContentType ?? 'application/octet-stream',
        size: result.ContentLength,
      };
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw new StorageUnavailableError('get', { cause: error });
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    options: { contentType: string },
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Body: body,
          Bucket: this.bucket,
          ContentLength: body.length,
          ContentType: options.contentType,
          Key: key,
        }),
      );
    } catch (error: unknown) {
      throw new StorageUnavailableError('put', { cause: error });
    }
  }

  destroy(): void {
    this.client.destroy();
  }

  onModuleDestroy(): void {
    this.destroy();
  }
}
