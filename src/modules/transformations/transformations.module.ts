import { Module } from '@nestjs/common';

import { FilesModule } from '@/modules/files';
import { SettingsModule } from '@/modules/settings';
import { UsersModule } from '@/modules/users';

import { TextConversionPool } from './text/text-conversion.pool';
import { TextConverter } from './text/text.converter';
import { TransformationsController } from './transformations.controller';
import { TransformationsRepository } from './transformations.repository';
import { TransformationsService } from './transformations.service';

@Module({
  controllers: [TransformationsController],
  exports: [TransformationsService],
  imports: [FilesModule, SettingsModule, UsersModule],
  providers: [
    TextConversionPool,
    TextConverter,
    TransformationsRepository,
    TransformationsService,
  ],
})
export class TransformationsModule {}
