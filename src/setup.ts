import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

export function configureApplication(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({
    origin: app.get(ConfigService).getOrThrow<string>('APP_ORIGIN'),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Library-Client'],
    methods: ['GET', 'POST'],
  });
  app.enableShutdownHooks();
}
