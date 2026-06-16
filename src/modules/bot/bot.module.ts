import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { UsersModule } from '../users/users.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [UsersModule, CategoriesModule, ProductsModule],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
