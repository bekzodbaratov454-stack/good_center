import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async findOrCreate(telegramUser: any): Promise<UserDocument> {
    let user = await this.userModel.findOne({ telegramId: telegramUser.id });
    if (!user) {
      user = await this.userModel.create({
        telegramId: telegramUser.id,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
      });
    } else {
      // Ma'lumotlarni yangilash
      user.firstName = telegramUser.first_name;
      user.lastName = telegramUser.last_name;
      user.username = telegramUser.username;
      await user.save();
    }
    return user;
  }

  async findByTelegramId(telegramId: number): Promise<UserDocument> {
    return this.userModel.findOne({ telegramId });
  }

  async setLanguage(telegramId: number, lang: string): Promise<void> {
    await this.userModel.updateOne({ telegramId }, { language: lang });
  }

  async setState(telegramId: number, state: string): Promise<void> {
    await this.userModel.updateOne({ telegramId }, { state });
  }

  async toggleFavorite(telegramId: number, productId: string): Promise<boolean> {
    const user = await this.findByTelegramId(telegramId);
    const idx = user.favorites.indexOf(productId);
    if (idx === -1) {
      user.favorites.push(productId);
      await user.save();
      return true; // qo'shildi
    } else {
      user.favorites.splice(idx, 1);
      await user.save();
      return false; // o'chirildi
    }
  }

  async incrementMessage(telegramId: number): Promise<void> {
    await this.userModel.updateOne({ telegramId }, { $inc: { messageCount: 1 } });
  }

  async getAllUsers(): Promise<UserDocument[]> {
    return this.userModel.find({ isBlocked: false });
  }

  async getUsersPaginated(page: number, limit = 10): Promise<{ users: UserDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.userModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      this.userModel.countDocuments(),
    ]);
    return { users, total };
  }

  async getUserCount(): Promise<number> {
    return this.userModel.countDocuments();
  }

  async getActiveUserCount(): Promise<number> {
    return this.userModel.countDocuments({ isBlocked: false });
  }
}
