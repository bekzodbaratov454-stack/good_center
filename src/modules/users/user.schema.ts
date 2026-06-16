import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  telegramId: number;

  @Prop()
  firstName: string;

  @Prop()
  lastName: string;

  @Prop()
  username: string;

  @Prop({ default: 'uz', enum: ['uz', 'ru', 'en'] })
  language: string;

  @Prop({ type: [String], default: [] })
  favorites: string[];

  @Prop({ default: false })
  isBlocked: boolean;

  @Prop({ default: 'idle' })
  state: string; // idle | waiting_question

  @Prop({ default: 0 })
  messageCount: number;
}

export const UserSchema = SchemaFactory.createForClass(User);
