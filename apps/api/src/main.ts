import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './core/exceptions/errors';
import { requestIdMiddleware } from './bootstrap/middlewares/request-id.middleware';
import { env } from './environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  if (env.TRUST_PROXY > 0) {
    // IP thật của client cho rate limit + nhật ký — chỉ tin đúng số tầng proxy đã khai báo.
    app.set('trust proxy', env.TRUST_PROXY);
  }

  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: false, // API thuần — client xử lý CSP của riêng mình
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: [
      env.APP_URL,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      // Bản web của app mobile (`expo start --web`) — chỉ để xem nhanh lúc dev. App native
      // không đi qua CORS.
      ...(env.NODE_ENV === 'production' ? [] : ['http://localhost:8081']),
    ],
    credentials: true,
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST, () => {
    console.log(`LEARN API sẵn sàng tại http://${env.HOST}:${env.PORT} (env=${env.NODE_ENV})`);
  });
}

void bootstrap();
