import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, CategoryDocument } from './category.schema';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
  ) {}

  async getAll(): Promise<CategoryDocument[]> {
    return this.categoryModel.find({ isActive: true }).sort({ order: 1 });
  }

  async getAllForAdmin(): Promise<CategoryDocument[]> {
    return this.categoryModel.find().sort({ order: 1 });
  }

  async findById(id: string): Promise<CategoryDocument> {
    return this.categoryModel.findById(id);
  }

  async create(data: Partial<Category>): Promise<CategoryDocument> {
    return this.categoryModel.create(data);
  }

  async update(id: string, data: Partial<Category>): Promise<CategoryDocument> {
    return this.categoryModel.findByIdAndUpdate(id, data, { new: true });
  }

  async delete(id: string): Promise<void> {
    await this.categoryModel.findByIdAndDelete(id);
  }

  async incrementView(id: string): Promise<void> {
    await this.categoryModel.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });
  }

  async getCount(): Promise<number> {
    return this.categoryModel.countDocuments({ isActive: true });
  }
}
