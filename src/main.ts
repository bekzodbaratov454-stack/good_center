import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🤖 Telegram Bot ishga tushdi! Port: ${port}`);
}
bootstrap();
