import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductDocument = Product & Document & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true })
  name: string;

  @Prop()
  nameRu: string;

  @Prop()
  nameEn: string;

  @Prop({ required: true })
  description: string;

  @Prop()
  descriptionRu: string;

  @Prop()
  descriptionEn: string;

  @Prop()
  price: string;

  @Prop({ type: [String], default: [] })
  photos: string[]; // Telegram file_id lar

  @Prop()
  phoneNumber: string;

  @Prop()
  location: string; // "lat,lng" formatida

  @Prop()
  locationName: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  viewCount: number;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
