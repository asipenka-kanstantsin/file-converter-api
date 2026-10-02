import { Module } from '@nestjs/common';

import { FilesModule } from '@/modules/files';
import { SettingsModule } from '@/modules/settings';
import { UsersModule } from '@/modules/users';

import { ImageConverter } from './image/image.converter';
import { SvgRenderer } from './image/svg-renderer';
import { ImagesController } from './images.controller';
import { TextConversionPool } from './text/text-conversion.pool';
import { TextConverter } from './text/text.converter';
import { TransformationsController } from './transformations.controller';
import { TransformationsRepository } from './transformations.repository';
import { TransformationsService } from './transformations.service';

@Module({
  controllers: [ImagesController, TransformationsController],
  exports: [TransformationsService],
  imports: [FilesModule, SettingsModule, UsersModule],
  providers: [
    ImageConverter,
    SvgRenderer,
    TextConversionPool,
    TextConverter,
    TransformationsRepository,
    TransformationsService,
  ],
})
export class TransformationsModule {}
