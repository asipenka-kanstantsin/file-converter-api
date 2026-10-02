import { Module, type OnModuleInit } from '@nestjs/common';

import { OutboxModule, OutboxRegistry } from '@/infrastructure/outbox';

import { FilesService, STORAGE_DELETE } from './files.service';

@Module({
  exports: [FilesService],
  imports: [OutboxModule],
  providers: [FilesService],
})
export class FilesModule implements OnModuleInit {
  constructor(
    private readonly files: FilesService,
    private readonly registry: OutboxRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(STORAGE_DELETE, (payload) =>
      this.files.deleteObject(payload),
    );
  }
}
