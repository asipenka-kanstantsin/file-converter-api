import { Global, Module } from '@nestjs/common';

import { AppConfig } from './app-config';
import { loadAppConfig } from './load-app-config';

@Global()
@Module({
  exports: [AppConfig],
  providers: [{ provide: AppConfig, useFactory: loadAppConfig }],
})
export class AppConfigModule {}
