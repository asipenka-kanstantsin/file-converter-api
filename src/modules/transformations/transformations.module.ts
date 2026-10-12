import { Module } from '@nestjs/common';

import { FilesModule } from '@/modules/files';
import { SettingsModule } from '@/modules/settings';
import { UsersModule } from '@/modules/users';

import { ConversionPool } from './conversion.pool';
import { DownloadsService } from './downloads.service';
import { HistoryCleanup } from './history-cleanup';
import {
  AdminHistoryController,
  HistoryController,
} from './history.controller';
import { HistoryService } from './history.service';
import { ImageConverter } from './image/image.converter';
import { SvgRenderer } from './image/svg-renderer';
import { ImagesController } from './images.controller';
import { TextConverter } from './text/text.converter';
import { TransformationsController } from './transformations.controller';
import { TransformationsRepository } from './transformations.repository';
import { TransformationsService } from './transformations.service';

@Module({
  controllers: [
    AdminHistoryController,
    HistoryController,
    ImagesController,
    TransformationsController,
  ],
  exports: [TransformationsService],
  imports: [FilesModule, SettingsModule, UsersModule],
  providers: [
    DownloadsService,
    HistoryCleanup,
    HistoryService,
    ImageConverter,
    SvgRenderer,
    ConversionPool,
    TextConverter,
    TransformationsRepository,
    TransformationsService,
  ],
})
export class TransformationsModule {}
