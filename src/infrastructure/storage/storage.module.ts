import { Global, Module } from '@nestjs/common';

import { AppConfig } from '@/config';

import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { STORAGE_PORT, type StoragePort } from './storage.port';

// STORAGE_DRIVER picks the adapter (12-storage); everything else depends on STORAGE_PORT only.
@Global()
@Module({
  exports: [STORAGE_PORT],
  providers: [
    {
      inject: [AppConfig],
      provide: STORAGE_PORT,
      useFactory: (config: AppConfig): StoragePort =>
        config.storage.driver === 's3'
          ? new S3Storage(config.storage.s3)
          : new LocalStorage(config.storage.localDir),
    },
  ],
})
export class StorageModule {}
