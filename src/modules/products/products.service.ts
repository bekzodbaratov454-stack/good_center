import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from './product.schema';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

  async getByCategory(categoryId: string): Promise<ProductDocument[]> {
    const objectId = new Types.ObjectId(categoryId);
    return this.productModel.find({
      $or: [
        { categoryId: objectId },
        { categoryId: categoryId },
      ],
      isActive: true,
    });
  }

  async findById(id: string): Promise<ProductDocument> {
    return this.productModel.findById(id);
  }

  async create(data: Partial<Product> & { categoryId: any }): Promise<ProductDocument> {
    const createData = {
      ...data,
      categoryId: new Types.ObjectId(data.categoryId),
    };
    return this.productModel.create(createData);
  }

  async update(id: string, data: Partial<Product>): Promise<ProductDocument> {
    return this.productModel.findByIdAndUpdate(id, data, { new: true });
  }

  async delete(id: string): Promise<void> {
    await this.productModel.findByIdAndDelete(id);
  }

  async incrementView(id: string): Promise<void> {
    await this.productModel.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });
  }

  async search(query: string): Promise<ProductDocument[]> {
    return this.productModel.find({
      isActive: true,
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { nameRu: { $regex: query, $options: 'i' } },
      ],
    }).limit(10);
  }

  async getByIds(ids: string[]): Promise<ProductDocument[]> {
    return this.productModel.find({
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
      isActive: true,
    });
  }

  async getTopViewed(): Promise<ProductDocument[]> {
    return this.productModel
      .find({ isActive: true })
      .sort({ viewCount: -1 })
      .limit(5);
  }

  async getCount(): Promise<number> {
    return this.productModel.countDocuments({ isActive: true });
  }

  async getCountByCategory(categoryId: string): Promise<number> {
    const objectId = new Types.ObjectId(categoryId);
    return this.productModel.countDocuments({
      $or: [{ categoryId: objectId }, { categoryId: categoryId }],
      isActive: true,
    });
  }

  async getAllForAdmin(): Promise<ProductDocument[]> {
    return this.productModel.find().sort({ createdAt: -1 });
  }
}
