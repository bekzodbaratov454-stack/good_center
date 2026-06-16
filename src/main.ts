import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Health check endpoint
  app.use('/health', (req: any, res: any) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🤖 Telegram Bot ishga tushdi! Port: ${port}`);
}
bootstrap();