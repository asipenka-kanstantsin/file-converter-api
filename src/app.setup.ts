import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from '@/common/http/request-id.middleware';
import { AppConfig } from '@/config';

export const API_PREFIX = 'api';

// Monitoring stays at the path the Notion NFR page names (decision H1).
const UNPREFIXED_ROUTES = ['health', 'health/live', 'health/ready'].map(
  (path) => ({ method: RequestMethod.GET, path }),
);

// Shared by main.ts and the e2e app factory, so tests run the same HTTP stack.
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED_ROUTES });
  app.use(requestIdMiddleware);
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.app.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: config.app.jsonBodyLimit });
  app.enableCors({
    allowedHeaders: [
      'Content-Type',
      'X-CSRF-Token',
      'X-Locale',
      REQUEST_ID_HEADER,
    ],
    credentials: true,
    exposedHeaders: ['Content-Disposition', REQUEST_ID_HEADER, 'Retry-After'],
    origin: [...config.app.corsOrigins],
  });
  app.enableShutdownHooks();
}
