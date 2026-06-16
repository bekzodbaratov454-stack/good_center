import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UsersService } from './users.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}







// # 1. Arxivni ochib, papkaga kiring
// tar -xzf telegram-bot.tar.gz && cd telegram-bot

// # 2. O'rnatish
// npm install

// # 3. .env faylini to'ldiring
// cp .env.example .env
// # BOT_TOKEN, MONGODB_URI, ADMIN_IDS ni to'ldiring

// # 4. Ishga tushirish
// npm run start:dev