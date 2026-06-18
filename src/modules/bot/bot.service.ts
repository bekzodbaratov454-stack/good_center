import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { UsersService } from '../users/users.service';
import { CategoriesService } from '../categories/categories.service';
import { ProductsService } from '../products/products.service';
import { t, Lang } from './i18n';
import {
  mainMenuKeyboard, cancelKeyboard, categoriesInlineKeyboard,
  productsInlineKeyboard, productDetailKeyboard, languageKeyboard,
  adminMainKeyboard, adminCategoryActions, adminProductActions,
  confirmDeleteKeyboard, usersPageKeyboard, superAdminMainKeyboard,
} from './keyboards';

@Injectable()
export class BotService implements OnModuleInit {
  private bot: Telegraf;
  private readonly logger = new Logger(BotService.name);
  private adminIds: number[];
  private superAdminId: number;
  private adminSessions: Map<number, any> = new Map();

  constructor(
    private config: ConfigService,
    private usersService: UsersService,
    private categoriesService: CategoriesService,
    private productsService: ProductsService,
  ) {
    this.bot = new Telegraf(this.config.get('BOT_TOKEN'));
    const rawIds = (this.config.get('ADMIN_IDS') || '')
      .split(',')
      .map((id: string) => parseInt(id.trim()))
      .filter(Boolean);
    this.superAdminId = rawIds[0];
    this.adminIds = rawIds;
  }

  async onModuleInit() {
    this.registerHandlers();
    const mode = this.config.get('BOT_MODE') || 'polling';
    if (mode === 'webhook') {
      const url = this.config.get('WEBHOOK_URL');
      await this.bot.telegram.setWebhook(`${url}/webhook`);
      this.logger.log(`Webhook set: ${url}/webhook`);
    } else {
      this.bot.launch();
      this.logger.log('Bot polling rejimida ishga tushdi');
    }
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }

  getBot() { return this.bot; }

  isSuperAdmin(userId: number): boolean {
    return userId === this.superAdminId;
  }

  async isAdmin(userId: number): Promise<boolean> {
    if (this.adminIds.includes(userId)) return true;
    return this.usersService.isDbAdmin(userId);
  }

  private async getUserLang(ctx: Context): Promise<Lang> {
    const tgUser = ctx.from;
    if (!tgUser) return 'uz';
    const user = await this.usersService.findByTelegramId(tgUser.id);
    return (user?.language as Lang) || 'uz';
  }

  // Markdown uchun barcha maxsus belgilarni tozalash
  private escapeMd(text: string): string {
    return (text || '').replace(/[*_`[\]()~>#+=|{}.!\-\\]/g, '\\$&');
  }

  // HTML parse_mode uchun escape (Markdowndan xavfsizroq)
  private escapeHtml(text: string): string {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private async safeEditMessage(ctx: Context, text: string, extra: any = {}) {
    try {
      const msg = (ctx as any).callbackQuery?.message;
      if (msg && (msg.photo || msg.video || msg.document || msg.audio)) {
        await ctx.editMessageCaption(text, { parse_mode: 'HTML', ...extra });
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...extra });
      }
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', ...extra });
    }
  }

  // Mahsulot matnini xavfsiz shakllantirish (HTML)
  private buildProductText(product: any, lang: Lang, viewCount: number): string {
    const name = lang === 'ru' && product.nameRu ? product.nameRu
      : lang === 'en' && product.nameEn ? product.nameEn : product.name;
    const desc = lang === 'ru' && product.descriptionRu ? product.descriptionRu
      : lang === 'en' && product.descriptionEn ? product.descriptionEn : product.description;

    const isNew = product.createdAt &&
      (Date.now() - new Date(product.createdAt).getTime()) < 3 * 24 * 60 * 60 * 1000;
    const newBadge = isNew ? '🆕 ' : '';

    let text = `${newBadge}<b>${this.escapeHtml(name)}</b>\n\n${this.escapeHtml(desc)}`;
    if (product.price) text += `\n\n💰 <b>${t(lang, 'price')}:</b> ${this.escapeHtml(product.price)}`;
    if (product.phoneNumber) text += `\n📞 <b>${t(lang, 'phone')}:</b> <code>${this.escapeHtml(product.phoneNumber)}</code>`;
    if (product.locationName) text += `\n📍 <b>${t(lang, 'address')}:</b> ${this.escapeHtml(product.locationName)}`;
    text += `\n\n👁 ${t(lang, 'views')}: ${viewCount}`;
    return text;
  }

  private registerHandlers() {
    // /start
    this.bot.start(async (ctx) => {
      const tgUser = ctx.from;
      const user = await this.usersService.findOrCreate(tgUser);
      const lang = user.language as Lang;

      const payload = (ctx as any).startPayload as string;
      if (payload?.startsWith('prod_')) {
        const prodId = payload.replace('prod_', '');
        const product = await this.productsService.findById(prodId);
        if (product) {
          await this.productsService.incrementView(prodId);
          const isFav = user.favorites.includes(prodId);
          const text = this.buildProductText(product, lang, product.viewCount + 1);
          const keyboard = productDetailKeyboard(product, lang, isFav);

          if (product.photos?.length) {
            const maxLen = 900;
            const shortText = text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
            await ctx.replyWithPhoto(product.photos[0], {
              caption: shortText,
              parse_mode: 'HTML',
              ...keyboard,
            });
            if (text.length > maxLen) {
              await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
            }
          } else {
            await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
          }

          if (!(await this.isAdmin(tgUser.id))) {
            await ctx.reply(t(lang, 'backToMenu'), mainMenuKeyboard(lang));
          }
          return;
        }
      }

      if (await this.isAdmin(tgUser.id)) {
        const welcomeKb = this.isSuperAdmin(tgUser.id) ? superAdminMainKeyboard() : adminMainKeyboard();
        await ctx.reply('👑 Admin paneliga xush kelibsiz!', welcomeKb);
      } else {
        await ctx.reply(t(lang, 'welcome', user.firstName), mainMenuKeyboard(lang));
      }
    });

    this.bot.hears('🌐 Til / Язык / Language', async (ctx) => {
      const lang = await this.getUserLang(ctx);
      await ctx.reply(t(lang, 'selectLanguage'), languageKeyboard());
    });

    this.bot.hears(['🏠 Bosh menyu', '🏠 Главное меню', '🏠 Main Menu'], async (ctx) => {
      const lang = await this.getUserLang(ctx);
      await this.usersService.setState(ctx.from.id, 'idle');
      this.adminSessions.delete(ctx.from.id);
      if (await this.isAdmin(ctx.from.id)) {
        const adminKb = this.isSuperAdmin(ctx.from.id) ? superAdminMainKeyboard() : adminMainKeyboard();
        await ctx.reply('Admin panel:', adminKb);
      } else {
        await ctx.reply(t(lang, 'backToMenu'), mainMenuKeyboard(lang));
      }
    });

    // ============ USER FLOWS ============

    this.bot.hears(['📂 Kategoriyalar', '📂 Категории', '📂 Categories'], async (ctx) => {
      if (await this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      const categories = await this.categoriesService.getAll();
      if (!categories.length) return ctx.reply(t(lang, 'noCategories'));

      const countEntries = await Promise.all(
        categories.map(async (cat) => {
          const count = await this.productsService.getCountByCategory(cat._id.toString());
          return [cat._id.toString(), count] as [string, number];
        }),
      );
      const counts = Object.fromEntries(countEntries);
      await ctx.reply(t(lang, 'selectCategory'), categoriesInlineKeyboard(categories, lang, counts));
    });

    this.bot.hears(['🔍 Qidiruv', '🔍 Поиск', '🔍 Search'], async (ctx) => {
      if (await this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      await this.usersService.setState(ctx.from.id, 'searching');
      await ctx.reply(t(lang, 'searchPrompt'), cancelKeyboard(lang));
    });

    this.bot.hears(['⭐ Sevimlilar', '⭐ Избранное', '⭐ Favorites'], async (ctx) => {
      if (await this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      const user = await this.usersService.findByTelegramId(ctx.from.id);
      if (!user || !user.favorites.length) return ctx.reply(t(lang, 'noFavorites'), mainMenuKeyboard(lang));
      const products = await this.productsService.getByIds(user.favorites);
      if (!products.length) return ctx.reply(t(lang, 'noFavorites'), mainMenuKeyboard(lang));
      const buttons = products.map((p) => {
        const name = lang === 'ru' && p.nameRu ? p.nameRu : lang === 'en' && p.nameEn ? p.nameEn : p.name;
        return [{ text: name, callback_data: `prod_${p._id}` }];
      });
      await ctx.reply(t(lang, 'favorites') + ':', { reply_markup: { inline_keyboard: buttons } });
    });

    this.bot.hears(['📩 Adminga savol', '📩 Вопрос администратору', '📩 Ask Admin'], async (ctx) => {
      if (await this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      await this.usersService.setState(ctx.from.id, 'waiting_question');
      await ctx.reply(t(lang, 'askAdminPrompt'), cancelKeyboard(lang));
    });

    this.bot.hears(
      ['📞 Aloqa & 📍 Manzil', '📞 Контакт & 📍 Адрес', '📞 Contact & 📍 Location'],
      async (ctx) => {
        if (await this.isAdmin(ctx.from.id)) return;
        await this.sendContactInfo(ctx);
      },
    );

    this.bot.hears(['📞 Telefon', '📞 Телефон', '📞 Phone'], async (ctx) => {
      if (await this.isAdmin(ctx.from.id)) return;
      await this.sendContactInfo(ctx);
    });

    this.bot.hears(['📍 Manzil', '📍 Адрес', '📍 Location'], async (ctx) => {
      if (await this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      const contactAddress = this.config.get('CONTACT_ADDRESS') || '';
      const contactLat = parseFloat(this.config.get('CONTACT_LAT') || '0');
      const contactLng = parseFloat(this.config.get('CONTACT_LNG') || '0');

      if (!contactAddress && !contactLat) return ctx.reply(t(lang, 'noContactInfo'));
      if (contactAddress) {
        await ctx.reply(
          `📍 <b>${t(lang, 'address')}:</b> ${this.escapeHtml(contactAddress)}`,
          { parse_mode: 'HTML' },
        );
      }
      if (contactLat && contactLng) await ctx.replyWithLocation(contactLat, contactLng);
    });

    // ============ CALLBACK QUERIES ============

    this.bot.action(/^cat_(.+)$/, async (ctx) => {
      const catId = ctx.match[1];
      const lang = await this.getUserLang(ctx);
      const category = await this.categoriesService.findById(catId);
      if (!category) return ctx.answerCbQuery('Topilmadi');

      await this.categoriesService.incrementView(catId);
      const products = await this.productsService.getByCategory(catId);

      const catName = lang === 'ru' && category.nameRu ? category.nameRu
        : lang === 'en' && category.nameEn ? category.nameEn : category.name;
      const emoji = category.emoji ? `${category.emoji} ` : '';

      if (!products.length) {
        await this.safeEditMessage(ctx, `${emoji}<b>${this.escapeHtml(catName)}</b>\n\n${t(lang, 'noProducts')}`);
        return ctx.answerCbQuery();
      }

      const text = `${emoji}<b>${this.escapeHtml(catName)}</b>\n\n${t(lang, 'selectProduct')}`;
      await this.safeEditMessage(ctx, text, productsInlineKeyboard(products, lang, catId));
      await ctx.answerCbQuery();
    });

    this.bot.action(/^prod_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const lang = await this.getUserLang(ctx);
      const product = await this.productsService.findById(prodId);
      if (!product) return ctx.answerCbQuery('Topilmadi');

      await this.productsService.incrementView(prodId);
      const user = await this.usersService.findByTelegramId(ctx.from.id);
      const isFav = user ? user.favorites.includes(prodId) : false;

      const text = this.buildProductText(product, lang, product.viewCount + 1);
      const keyboard = productDetailKeyboard(product, lang, isFav);

      try { await ctx.deleteMessage(); } catch {}

      if (product.photos?.length) {
        if (product.photos.length === 1) {
          const maxLen = 900;
          const shortText = text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
          await ctx.replyWithPhoto(product.photos[0], {
            caption: shortText,
            parse_mode: 'HTML',
            ...keyboard,
          });
          if (text.length > maxLen) {
            await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
          }
        } else {
          const media = product.photos.map((ph) => ({
            type: 'photo' as const,
            media: ph,
          }));
          await ctx.replyWithMediaGroup(media as any);
          await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
        }
      } else {
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
      }

      await ctx.answerCbQuery();
    });

    this.bot.action(/^call_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const product = await this.productsService.findById(prodId);
      const lang = await this.getUserLang(ctx);
      if (!product?.phoneNumber) return ctx.answerCbQuery(t(lang, 'noPhone'));
      await ctx.answerCbQuery();
      await ctx.reply(
        `📞 <b>${this.escapeHtml(product.name)}</b>\n\n${t(lang, 'phone')}: <code>${this.escapeHtml(product.phoneNumber)}</code>`,
        { parse_mode: 'HTML' },
      );
    });

    this.bot.action(/^loc_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const product = await this.productsService.findById(prodId);
      const lang = await this.getUserLang(ctx);
      if (!product?.location && !product?.locationName) return ctx.answerCbQuery(t(lang, 'noLocation'));
      await ctx.answerCbQuery();
      if (product.location) {
        const [lat, lng] = product.location.split(',').map(Number);
        if (lat && lng) {
          await ctx.replyWithLocation(lat, lng);
          if (product.locationName) await ctx.reply(`📍 ${this.escapeHtml(product.locationName)}`);
          return;
        }
      }
      if (product.locationName) await ctx.reply(`📍 ${this.escapeHtml(product.locationName)}`);
    });

    this.bot.action(/^contact_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const product = await this.productsService.findById(prodId);
      if (!product) return ctx.answerCbQuery('Topilmadi');
      await ctx.answerCbQuery();

      const lang = await this.getUserLang(ctx);
      let text = `📋 <b>${this.escapeHtml(product.name)}</b>\n\n`;
      if (product.phoneNumber) text += `📞 <b>${t(lang, 'phone')}:</b> <code>${this.escapeHtml(product.phoneNumber)}</code>\n`;
      if (product.locationName) text += `📍 <b>${t(lang, 'address')}:</b> ${this.escapeHtml(product.locationName)}\n`;

      await ctx.reply(text, { parse_mode: 'HTML' });

      if (product.location) {
        const [lat, lng] = product.location.split(',').map(Number);
        if (lat && lng) await ctx.replyWithLocation(lat, lng);
      }
    });

    this.bot.action(/^fav_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const lang = await this.getUserLang(ctx);
      const added = await this.usersService.toggleFavorite(ctx.from.id, prodId);
      await ctx.answerCbQuery(added ? t(lang, 'addedFavorite') : t(lang, 'removedFavorite'));
    });

    this.bot.action(/^share_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      await ctx.answerCbQuery();
      const botInfo = await this.bot.telegram.getMe();
      await ctx.reply(`📤 Ushbu mahsulotni ulashing:\nhttps://t.me/${botInfo.username}?start=prod_${prodId}`);
    });

    this.bot.action(/^lang_(uz|ru|en)$/, async (ctx) => {
      const lang = ctx.match[1] as Lang;
      await this.usersService.setLanguage(ctx.from.id, lang);
      await ctx.answerCbQuery(t(lang, 'languageChanged'));
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply(t(lang, 'welcome', ctx.from.first_name), mainMenuKeyboard(lang));
    });

    this.bot.action(/^reply_(\d+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const targetUserId = parseInt(ctx.match[1]);
      await ctx.answerCbQuery();
      this.adminSessions.set(ctx.from.id, {
        action: 'reply_to_user',
        targetUserId,
        step: 'message',
      });
      await ctx.reply(
        `📨 <b>User #${targetUserId}</b> ga javob yozing:`,
        { parse_mode: 'HTML', ...cancelKeyboard('uz') },
      );
    });

    // ============ ADMIN FLOWS ============

    this.bot.hears("➕ Kategoriya qo'sh", async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      this.adminSessions.set(ctx.from.id, { action: 'add_category', step: 'name' });
      await ctx.reply(
        "📝 Kategoriya nomini kiriting:\n\nNamuna: 🏠 Uy jihozlari\n(Emoji qo'shsangiz avtomatik ajratiladi)",
        cancelKeyboard('uz'),
      );
    });

    this.bot.hears("📦 Mahsulot qo'sh", async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const categories = await this.categoriesService.getAllForAdmin();
      if (!categories.length) return ctx.reply("Avval kategoriya qo'shing!");
      this.adminSessions.set(ctx.from.id, { action: 'add_product', step: 'category' });
      const buttons = categories.map((c) => [
        { text: `${c.emoji || ''} ${c.name}`, callback_data: `admin_choose_cat_${c._id}` },
      ]);
      await ctx.reply("Qaysi kategoriyaga mahsulot qo'shmoqchisiz?", {
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.hears('📋 Kategoriyalar', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const categories = await this.categoriesService.getAllForAdmin();
      if (!categories.length) return ctx.reply("Kategoriyalar yo'q.");

      let text = "📋 <b>Kategoriyalar ro'yxati:</b>\n\n";
      categories.forEach((cat, i) => {
        const status = cat.isActive ? '✅' : '❌';
        text += `${i + 1}. ${status} ${cat.emoji || ''} <b>${this.escapeHtml(cat.name)}</b>  (👁 ${cat.viewCount})\n`;
      });

      const buttons = categories.map((cat) => [
        { text: `${cat.emoji || ''} ${cat.name}`, callback_data: `admin_cat_menu_${cat._id}` },
      ]);

      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.action(/^admin_cat_menu_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const catId = ctx.match[1];
      const cat = await this.categoriesService.findById(catId);
      if (!cat) return ctx.answerCbQuery('Topilmadi');
      await ctx.answerCbQuery();
      await ctx.reply(
        `${cat.emoji || ''} <b>${this.escapeHtml(cat.name)}</b>\nNima qilmoqchisiz?`,
        { parse_mode: 'HTML', ...adminCategoryActions(catId) },
      );
    });

    this.bot.hears('📦 Mahsulotlar', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const products = await this.productsService.getAllForAdmin();
      if (!products.length) return ctx.reply("Mahsulotlar yo'q.");

      let text = "📦 <b>Mahsulotlar ro'yxati:</b>\n\n";
      products.forEach((prod, i) => {
        const status = prod.isActive ? '✅' : '❌';
        text += `${i + 1}. ${status} <b>${this.escapeHtml(prod.name)}</b>`;
        if (prod.price) text += ` — ${this.escapeHtml(prod.price)}`;
        text += `  (👁 ${prod.viewCount})\n`;
      });

      const buttons = products.map((prod) => [
        { text: prod.name, callback_data: `admin_prod_menu_${prod._id}` },
      ]);

      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.action(/^admin_prod_menu_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const prodId = ctx.match[1];
      const prod = await this.productsService.findById(prodId);
      if (!prod) return ctx.answerCbQuery('Topilmadi');
      await ctx.answerCbQuery();
      await ctx.reply(
        `📦 <b>${this.escapeHtml(prod.name)}</b>\nNima qilmoqchisiz?`,
        { parse_mode: 'HTML', ...adminProductActions(prodId) },
      );
    });

    this.bot.action(/^admin_edit_prod_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const prodId = ctx.match[1];
      const prod = await this.productsService.findById(prodId);
      if (!prod) return ctx.answerCbQuery('Topilmadi');
      await ctx.answerCbQuery();

      this.adminSessions.set(ctx.from.id, {
        action: 'edit_product',
        productId: prodId,
        step: 'field',
      });

      await ctx.reply(
        `✏️ <b>${this.escapeHtml(prod.name)}</b> — Nimani tahrirlamoqchisiz?`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Nom', callback_data: `admin_edit_field_name_${prodId}` }],
              [{ text: '📄 Tavsif', callback_data: `admin_edit_field_desc_${prodId}` }],
              [{ text: '💰 Narx', callback_data: `admin_edit_field_price_${prodId}` }],
              [{ text: '📞 Telefon', callback_data: `admin_edit_field_phone_${prodId}` }],
              [{ text: '📍 Manzil nomi', callback_data: `admin_edit_field_locname_${prodId}` }],
              [{ text: '📸 Rasmlar', callback_data: `admin_edit_field_photos_${prodId}` }],
              [{ text: '❌ Bekor qilish', callback_data: 'cancel_action' }],
            ],
          },
        },
      );
    });

    this.bot.action(/^admin_edit_cat_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const catId = ctx.match[1];
      const cat = await this.categoriesService.findById(catId);
      if (!cat) return ctx.answerCbQuery('Topilmadi');
      await ctx.answerCbQuery();

      this.adminSessions.set(ctx.from.id, {
        action: 'edit_category',
        categoryId: catId,
        step: 'name',
      });

      await ctx.reply(
        `✏️ <b>${this.escapeHtml(cat.name)}</b> — Yangi nomini kiriting:\n\nNamuna: 🏠 Uy jihozlari`,
        { parse_mode: 'HTML', ...cancelKeyboard('uz') },
      );
    });

    this.bot.action(/^admin_edit_field_(name|desc|price|phone|locname|photos)_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const field = ctx.match[1];
      const prodId = ctx.match[2];
      await ctx.answerCbQuery();

      this.adminSessions.set(ctx.from.id, {
        action: 'edit_product',
        productId: prodId,
        step: field,
      });

      const prompts: Record<string, string> = {
        name: '📝 Yangi nomni kiriting:',
        desc: '📄 Yangi tavsifni kiriting:',
        price: '💰 Yangi narxni kiriting:',
        phone: '📞 Yangi telefon raqamini kiriting:',
        locname: '📍 Yangi manzil nomini kiriting:',
        photos: '📸 Yangi rasmlarni yuboring:',
      };

      if (field === 'photos') {
        await ctx.reply(prompts[field], {
          reply_markup: {
            inline_keyboard: [[{ text: "⏭ Rasmsiz o'tkazib yuborish", callback_data: 'admin_edit_photos_done' }]],
          },
        });
      } else {
        await ctx.reply(prompts[field], cancelKeyboard('uz'));
      }
    });

    this.bot.action('admin_edit_photos_done', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session || session.action !== 'edit_product') return;
      await ctx.answerCbQuery();
      await this.saveEditedProduct(ctx, session);
    });

    this.bot.hears("👥 Foydalanuvchilar", async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      await this.sendUsersPage(ctx, 1);
    });

    this.bot.action(/^users_page_(\d+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const page = parseInt(ctx.match[1]);
      await ctx.answerCbQuery();
      await this.sendUsersPage(ctx, page, true);
    });

    this.bot.action('noop', async (ctx) => ctx.answerCbQuery());

    this.bot.hears('📊 Statistika', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const [userCount, activeUsers, catCount, prodCount, topProducts] = await Promise.all([
        this.usersService.getUserCount(),
        this.usersService.getActiveUserCount(),
        this.categoriesService.getCount(),
        this.productsService.getCount(),
        this.productsService.getTopViewed(),
      ]);
      let text = `📊 <b>Bot Statistikasi</b>\n\n`;
      text += `👤 Jami foydalanuvchilar: <b>${userCount}</b>\n`;
      text += `✅ Aktiv: <b>${activeUsers}</b>\n`;
      text += `📂 Kategoriyalar: <b>${catCount}</b>\n`;
      text += `📦 Mahsulotlar: <b>${prodCount}</b>\n\n`;
      text += `🔥 <b>Eng ko'p ko'rilgan:</b>\n`;
      topProducts.forEach((p, i) => {
        text += `${i + 1}. ${this.escapeHtml(p.name)} — ${p.viewCount} ko'rishlar\n`;
      });
      await ctx.reply(text, { parse_mode: 'HTML' });
    });

    // ===================== ADMINLAR BOSHQARUVI (faqat superAdmin) =====================

    this.bot.hears('👑 Adminlar', async (ctx) => {
      if (!this.isSuperAdmin(ctx.from.id)) return;
      const admins = await this.usersService.getAdmins();
      const dbAdmins = admins.filter(a => !this.adminIds.includes(a.telegramId));

      let text = `👑 <b>Adminlar ro'yxati</b>\n\n🔒 <b>Asosiy admin (ENV):</b>\n• ID: <code>${this.superAdminId}</code> — siz\n`;

      if (dbAdmins.length === 0) {
        text += "\n📋 <b>Qo'shimcha adminlar:</b> hali yo'q";
      } else {
        text += "\n📋 <b>Qo'shimcha adminlar:</b>\n";
        for (const a of dbAdmins) {
          const name = this.escapeHtml(
            [a.firstName, a.lastName].filter(Boolean).join(' ') || 'Nomsiz'
          );
          const username = a.username
            ? ` (@${this.escapeHtml(a.username)})`
            : '';
          text += `• ${name}${username} — ID: <code>${a.telegramId}</code>\n`;
        }
      }

      const buttons: any[] = [];
      for (const a of dbAdmins) {
        const name = [a.firstName, a.lastName].filter(Boolean).join(' ') || 'Nomsiz';
        buttons.push([{ text: `❌ ${name} ni o'chirish`, callback_data: `remove_admin_${a.telegramId}` }]);
      }
      buttons.push([{ text: "➕ Yangi admin qo'shish", callback_data: 'add_admin_start' }]);

      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.action('add_admin_start', async (ctx) => {
      if (!this.isSuperAdmin(ctx.from.id)) return;
      await ctx.answerCbQuery();
      this.adminSessions.set(ctx.from.id, { action: 'add_admin', step: 'id' });
      await ctx.reply(
        "➕ <b>Yangi admin qo'shish</b>\n\nAdmin qilmoqchi bo'lgan foydalanuvchining Telegram ID sini kiriting:\n<i>(Foydalanuvchi avval botga /start bosgan bo'lishi kerak)</i>",
        { parse_mode: 'HTML', ...cancelKeyboard('uz') },
      );
    });

    this.bot.action(/^remove_admin_(\d+)$/, async (ctx) => {
      if (!this.isSuperAdmin(ctx.from.id)) return;
      const targetId = parseInt(ctx.match[1]);
      await ctx.answerCbQuery();
      const user = await this.usersService.findByTelegramId(targetId);
      if (!user) {
        await ctx.reply("❌ Foydalanuvchi topilmadi.");
        return;
      }
      const name = this.escapeHtml(
        [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Nomsiz'
      );
      await ctx.reply(
        `⚠️ <b>${name}</b> (ID: <code>${targetId}</code>) ni admin huquqidan mahrum qilmoqchimisiz?`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Ha, o'chir", callback_data: `confirm_remove_admin_${targetId}` },
                { text: "❌ Bekor", callback_data: 'cancel_action' },
              ],
            ],
          },
        },
      );
    });

    this.bot.action(/^confirm_remove_admin_(\d+)$/, async (ctx) => {
      if (!this.isSuperAdmin(ctx.from.id)) return;
      const targetId = parseInt(ctx.match[1]);
      await ctx.answerCbQuery();
      await this.usersService.setAdmin(targetId, false);
      try {
        await this.bot.telegram.sendMessage(targetId, "⚠️ Sizning admin huquqingiz bekor qilindi.");
      } catch {}
      await ctx.editMessageText("✅ Admin huquqi bekor qilindi.");
    });

    // ===================== END ADMINLAR BOSHQARUVI =====================

    this.bot.hears('📢 Xabar yuborish', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      this.adminSessions.set(ctx.from.id, { action: 'broadcast', step: 'message' });
      await ctx.reply(
        "📢 Barcha foydalanuvchilarga yubormoqchi bo'lgan xabaringizni yozing:",
        cancelKeyboard('uz'),
      );
    });

    this.bot.action(/^admin_choose_cat_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const catId = ctx.match[1];
      const session = this.adminSessions.get(ctx.from.id) || { action: 'add_product' };
      session.categoryId = catId;
      session.step = 'name';
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply('📝 Mahsulot nomini kiriting:');
    });

    this.bot.action(/^admin_add_prod_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const catId = ctx.match[1];
      this.adminSessions.set(ctx.from.id, {
        action: 'add_product',
        step: 'name',
        categoryId: catId,
      });
      await ctx.answerCbQuery();
      await ctx.reply("📝 Mahsulot nomini kiriting:");
    });

    this.bot.action(/^admin_del_cat_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const catId = ctx.match[1];
      await ctx.answerCbQuery();
      await ctx.reply("⚠️ Kategoriyani o'chirishni tasdiqlaysizmi?", confirmDeleteKeyboard('cat', catId));
    });

    this.bot.action(/^admin_del_prod_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const prodId = ctx.match[1];
      await ctx.answerCbQuery();
      await ctx.reply("⚠️ Mahsulotni o'chirishni tasdiqlaysizmi?", confirmDeleteKeyboard('prod', prodId));
    });

    this.bot.action(/^confirm_del_(cat|prod)_(.+)$/, async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const type = ctx.match[1];
      const id = ctx.match[2];
      if (type === 'cat') {
        await this.categoriesService.delete(id);
        await ctx.editMessageText("✅ Kategoriya o'chirildi!");
      } else {
        await this.productsService.delete(id);
        await ctx.editMessageText("✅ Mahsulot o'chirildi!");
      }
      await ctx.answerCbQuery();
    });

    this.bot.action('cancel_action', async (ctx) => {
      this.adminSessions.delete(ctx.from.id);
      try { await ctx.editMessageText('❌ Bekor qilindi'); } catch {}
      await ctx.answerCbQuery();
    });

    this.bot.action('admin_photos_done', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      await ctx.answerCbQuery('✅ Rasmlar saqlandi!');
      if (session.action === 'add_product') {
        await this.saveProduct(ctx);
      }
    });

    this.bot.action('admin_photos_clear', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.photos = [];
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery('🗑 Rasmlar tozalandi');
      await ctx.reply("🗑 Barcha rasmlar o'chirildi.\n\n📸 Qaytadan rasm yuboring:", {
        reply_markup: {
          inline_keyboard: [[{ text: "✅ Rasmsiz saqlash", callback_data: 'admin_photos_done' }]],
        },
      });
    });

    this.bot.action('admin_skip_price', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.price = null;
      await ctx.answerCbQuery();

      if (session.action === 'add_product') {
        session.step = 'photos';
        this.adminSessions.set(ctx.from.id, session);
        await ctx.reply("📸 Mahsulot rasmini yuboring (bir nechta bo'lishi mumkin):", {
          reply_markup: {
            inline_keyboard: [[{ text: "⏭ Rasmsiz saqlash", callback_data: 'admin_photos_done' }]],
          },
        });
      } else if (session.action === 'edit_product') {
        session.price = null;
        await this.saveEditedProduct(ctx, session);
      }
    });

    this.bot.action('admin_skip_name_ru', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.step = 'name_en';
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply(
        '🇬🇧 Ingliz tilidagi nomini kiriting (ixtiyoriy):',
        { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_name_en' }]] } },
      );
    });

    this.bot.action('admin_skip_name_en', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.step = 'description';
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply("📝 O'zbek tilidagi tavsifini kiriting:");
    });

    this.bot.action('admin_skip_desc_ru', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.step = 'description_en';
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply(
        '🇬🇧 Ingliz tilidagi tavsifini kiriting (ixtiyoriy):',
        { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_desc_en' }]] } },
      );
    });

    this.bot.action('admin_skip_desc_en', async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.step = 'phone';
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply(
        '📞 Telefon raqamini kiriting (ixtiyoriy):\n\nNamuna: +998901234567',
        { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_phone_to_loc' }]] } },
      );
    });

    this.bot.action("admin_skip_phone_to_loc", async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.phone = null;
      session.step = "location_name";
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await this.askLocation(ctx);
    });

    this.bot.action("admin_skip_location_all", async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.locationName = null;
      session.location = null;
      session.step = "price";
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply("💰 Narxini kiriting (ixtiyoriy):", {
        reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: "admin_skip_price" }]] },
      });
    });

    this.bot.action("admin_skip_coords", async (ctx) => {
      if (!(await this.isAdmin(ctx.from.id))) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.location = null;
      session.step = "price";
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply("💰 Narxini kiriting (ixtiyoriy):", {
        reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: "admin_skip_price" }]] },
      });
    });

    this.bot.on('location', async (ctx) => {
      const userId = ctx.from.id;
      if (!(await this.isAdmin(userId))) return;
      const session = this.adminSessions.get(userId);
      if (!session) return;

      const loc = (ctx.message as any).location;
      session.location = `${loc.latitude},${loc.longitude}`;
      if (!session.locationName) session.locationName = 'Lokatsiya';
      session.step = 'price';
      this.adminSessions.set(userId, session);

      await ctx.reply("✅ Lokatsiya saqlandi!\n\n💰 Narxini kiriting (ixtiyoriy):", {
        reply_markup: {
          inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_price' }]],
        },
      });
    });

    this.bot.on('photo', async (ctx) => {
      const userId = ctx.from.id;
      if (!(await this.isAdmin(userId))) return;
      const session = this.adminSessions.get(userId);
      if (!session) return;

      const isPhotosStep = session.step === 'photos';
      const isEditPhotos = session.action === 'edit_product' && session.step === 'photos';
      if (!isPhotosStep && !isEditPhotos) return;

      const photo = (ctx.message as any).photo;
      const fileId = photo[photo.length - 1].file_id;
      if (!session.photos) session.photos = [];
      session.photos.push(fileId);
      this.adminSessions.set(userId, session);

      const count = session.photos.length;
      const doneCallback = session.action === 'edit_product' ? 'admin_edit_photos_done' : 'admin_photos_done';

      await ctx.replyWithPhoto(fileId, {
        caption: `✅ <b>${count}-rasm qabul qilindi</b>\n\nJami: ${count} ta rasm\n\nYana rasm yuboring yoki saqlashni tasdiqlang:`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: `✅ Saqlash (${count} ta rasm)`, callback_data: doneCallback }],
            [{ text: '🗑 Rasmlarni tozalash', callback_data: 'admin_photos_clear' }],
          ],
        },
      });
    });

    this.bot.on('text', async (ctx) => {
      const userId = ctx.from.id;
      const text = ctx.message.text;

      if (text === '❌ Bekor qilish' || text === '❌ Отмена' || text === '❌ Cancel') {
        await this.usersService.setState(userId, 'idle');
        this.adminSessions.delete(userId);
        const lang = await this.getUserLang(ctx);
        if (await this.isAdmin(userId)) {
          const kb = this.isSuperAdmin(userId) ? superAdminMainKeyboard() : adminMainKeyboard();
          return ctx.reply('❌ Bekor qilindi', kb);
        }
        return ctx.reply('❌ Bekor qilindi', mainMenuKeyboard(lang));
      }

      if (await this.isAdmin(userId)) {
        const session = this.adminSessions.get(userId);
        if (session) return this.handleAdminSession(ctx, session, text);
        return;
      }

      const user = await this.usersService.findByTelegramId(userId);
      if (!user) return;
      await this.usersService.incrementMessage(userId);

      if (user.state === 'searching') return this.handleSearch(ctx, text, user.language as Lang);
      if (user.state === 'waiting_question') return this.handleUserQuestion(ctx, text, user);
    });
  }

  // ============ HELPER METHODS ============

  private async sendUsersPage(ctx: Context, page: number, edit = false) {
    try {
      const limit = 10;
      const { users, total } = await this.usersService.getUsersPaginated(page, limit);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;

      let text = `👥 Foydalanuvchilar ro'yxati (${total} ta)\n`;
      text += `📄 Sahifa: ${page}/${totalPages}\n\n`;

      if (users.length === 0) {
        text += 'Foydalanuvchilar topilmadi.';
      } else {
        users.forEach((u, i) => {
          const num = (page - 1) * limit + i + 1;
          const name = this.escapeHtml(
            [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Nomsiz'
          );
          const username = u.username ? ` @${this.escapeHtml(u.username)}` : '';
          const lang = (u.language || 'uz').toUpperCase();
          const blocked = u.isBlocked ? ' 🚫' : '';
          text += `${num}. ${name}${username}\n`;
          text += `   🌐 ${lang} | 💬 ${u.messageCount || 0} xabar${blocked}\n\n`;
        });
      }

      const keyboard = usersPageKeyboard(page, totalPages);

      if (edit) {
        try {
          await (ctx as any).editMessageText(text, keyboard);
        } catch (editErr: any) {
          if (!editErr?.description?.includes('message is not modified')) {
            await ctx.reply(text, keyboard);
          }
        }
      } else {
        await ctx.reply(text, keyboard);
      }
    } catch (err) {
      this.logger.error('sendUsersPage xatosi:', err);
      await ctx.reply("❌ Foydalanuvchilar ro'yxatini yuklashda xato. Qaytadan urinib ko'ring.");
    }
  }

  private async sendContactInfo(ctx: Context) {
    const lang = await this.getUserLang(ctx);
    const contactPhone = this.config.get('CONTACT_PHONE') || '';
    const contactAddress = this.config.get('CONTACT_ADDRESS') || '';
    const contactLat = parseFloat(this.config.get('CONTACT_LAT') || '0');
    const contactLng = parseFloat(this.config.get('CONTACT_LNG') || '0');

    let text = `📋 <b>${t(lang, 'contactInfo')}</b>\n\n`;
    if (contactPhone) text += `📞 <b>${t(lang, 'phone')}:</b> <code>${this.escapeHtml(contactPhone)}</code>\n`;
    if (contactAddress) text += `📍 <b>${t(lang, 'address')}:</b> ${this.escapeHtml(contactAddress)}\n`;
    if (!contactPhone && !contactAddress) text += t(lang, 'noContactInfo');

    await ctx.reply(text, { parse_mode: 'HTML' });
    if (contactLat && contactLng) await ctx.replyWithLocation(contactLat, contactLng);
  }

  private async handleSearch(ctx: Context, query: string, lang: Lang) {
    const products = await this.productsService.search(query);
    await this.usersService.setState(ctx.from.id, 'idle');
    if (!products.length) return ctx.reply(t(lang, 'searchNoResult'), mainMenuKeyboard(lang));
    const buttons = products.map((p) => {
      const name = lang === 'ru' && p.nameRu ? p.nameRu : lang === 'en' && p.nameEn ? p.nameEn : p.name;
      return [{ text: name, callback_data: `prod_${p._id}` }];
    });
    await ctx.reply(t(lang, 'searchResult', products.length), {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async handleUserQuestion(ctx: Context, question: string, user: any) {
    const lang = user.language as Lang;
    for (const adminId of this.adminIds) {
      try {
        const userName = this.escapeHtml(
          [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Nomsiz'
        );
        const userLink = user.username
          ? `@${this.escapeHtml(user.username)}`
          : `ID: ${user.telegramId}`;
        await this.bot.telegram.sendMessage(
          adminId,
          `📩 <b>Yangi savol!</b>\n\n👤 ${userName} (${userLink})\n\n❓ ${this.escapeHtml(question)}`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '📨 Javob berish', callback_data: `reply_${user.telegramId}` }]],
            },
          },
        );
      } catch {}
    }
    await this.usersService.setState(user.telegramId, 'idle');
    await ctx.reply(t(lang, 'questionSent'), mainMenuKeyboard(lang));
  }

  private async handleAdminSession(ctx: Context, session: any, text: string) {
    const userId = ctx.from.id;

    if (session.action === 'add_category') {
      if (session.step === 'name') {
        const emojiMatch = text.match(/(\p{Emoji})/u);
        const name = emojiMatch ? text.replace(emojiMatch[1], '').trim() : text.trim();
        const emoji = emojiMatch ? emojiMatch[1] : '';
        await this.categoriesService.create({ name, emoji });
        this.adminSessions.delete(userId);
        await ctx.reply(
          `✅ Kategoriya qo'shildi!\n\n${emoji} <b>${this.escapeHtml(name)}</b>`,
          { parse_mode: 'HTML', ...adminMainKeyboard() },
        );
      }
      return;
    }

    if (session.action === 'edit_category') {
      if (session.step === 'name') {
        const emojiMatch = text.match(/(\p{Emoji})/u);
        const name = emojiMatch ? text.replace(emojiMatch[1], '').trim() : text.trim();
        const emoji = emojiMatch ? emojiMatch[1] : '';
        await this.categoriesService.update(session.categoryId, { name, emoji });
        this.adminSessions.delete(userId);
        await ctx.reply(
          `✅ Kategoriya yangilandi!\n\n${emoji} <b>${this.escapeHtml(name)}</b>`,
          { parse_mode: 'HTML', ...adminMainKeyboard() },
        );
      }
      return;
    }

    if (session.action === 'add_product') {
      if (session.step === 'name') {
        session.name = text; session.step = 'name_ru';
        this.adminSessions.set(userId, session);
        await ctx.reply('🇷🇺 Rus tilidagi nomini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_name_ru' }]] } });
        return;
      }
      if (session.step === 'name_ru') {
        session.nameRu = text; session.step = 'name_en';
        this.adminSessions.set(userId, session);
        await ctx.reply('🇬🇧 Ingliz tilidagi nomini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_name_en' }]] } });
        return;
      }
      if (session.step === 'name_en') {
        session.nameEn = text; session.step = 'description';
        this.adminSessions.set(userId, session);
        await ctx.reply("📝 O'zbek tilidagi tavsifini kiriting:");
        return;
      }
      if (session.step === 'description') {
        session.description = text; session.step = 'description_ru';
        this.adminSessions.set(userId, session);
        await ctx.reply('🇷🇺 Rus tilidagi tavsifini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_desc_ru' }]] } });
        return;
      }
      if (session.step === 'description_ru') {
        session.descriptionRu = text; session.step = 'description_en';
        this.adminSessions.set(userId, session);
        await ctx.reply('🇬🇧 Ingliz tilidagi tavsifini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_desc_en' }]] } });
        return;
      }
      if (session.step === 'description_en') {
        session.descriptionEn = text; session.step = 'phone';
        this.adminSessions.set(userId, session);
        await ctx.reply('📞 Telefon raqamini kiriting (ixtiyoriy):\n\nNamuna: +998901234567',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_phone_to_loc' }]] } });
        return;
      }
      if (session.step === 'phone') {
        session.phone = text; session.step = 'location_name';
        this.adminSessions.set(userId, session);
        await this.askLocation(ctx);
        return;
      }
      if (session.step === 'location_name') {
        session.locationName = text; session.step = 'location_coords';
        this.adminSessions.set(userId, session);
        await ctx.reply("📌 Telegram lokatsiya tugmasi orqali aniq joylashuvni yuboring yoki o'tkazib yuboring:",
          { reply_markup: { inline_keyboard: [[{ text: "⏭ Koordinatasiz saqlash", callback_data: 'admin_skip_coords' }]] } });
        return;
      }
      if (session.step === 'location_coords') {
        session.location = null; session.step = 'price';
        this.adminSessions.set(userId, session);
        await ctx.reply('💰 Narxini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_price' }]] } });
        return;
      }
      if (session.step === 'price') {
        session.price = text; session.step = 'photos';
        this.adminSessions.set(userId, session);
        await ctx.reply("📸 Mahsulot rasmini yuboring (bir nechta bo'lishi mumkin):",
          { reply_markup: { inline_keyboard: [[{ text: "⏭ Rasmsiz saqlash", callback_data: 'admin_photos_done' }]] } });
        return;
      }
      if (session.step === 'photos') {
        await ctx.reply('📸 Iltimos rasm yuboring yoki saqlashni tasdiqlang:',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ Rasmsiz saqlash", callback_data: 'admin_photos_done' }]] } });
        return;
      }
    }

    if (session.action === 'edit_product') {
      if (session.step === 'photos') {
        await ctx.reply('📸 Iltimos rasm yuboring yoki saqlashni tasdiqlang:',
          { reply_markup: { inline_keyboard: [[{ text: "✅ Saqlash", callback_data: 'admin_edit_photos_done' }]] } });
        return;
      }

      // Matn fieldlarini sessionga yozib, darhol saqlash
      const updateData: any = {};
      if (session.step === 'name') { updateData.name = text; session.name = text; }
      else if (session.step === 'desc') { updateData.description = text; session.description = text; }
      else if (session.step === 'price') { updateData.price = text; session.price = text; }
      else if (session.step === 'phone') { updateData.phoneNumber = text; session.phoneNumber = text; }
      else if (session.step === 'locname') { updateData.locationName = text; session.locationName = text; }

      if (Object.keys(updateData).length > 0) {
        await this.productsService.update(session.productId, updateData);
        this.adminSessions.delete(userId);
        const prod = await this.productsService.findById(session.productId);
        await ctx.reply(
          `✅ <b>${this.escapeHtml(prod?.name || 'Mahsulot')}</b> yangilandi!`,
          { parse_mode: 'HTML', ...adminMainKeyboard() },
        );
      }
      return;
    }

    if (session.action === 'reply_to_user' && session.step === 'message') {
      const targetUserId = session.targetUserId;
      this.adminSessions.delete(userId);
      try {
        await this.bot.telegram.sendMessage(
          targetUserId,
          `📨 <b>Admin javob berdi:</b>\n\n${this.escapeHtml(text)}`,
          { parse_mode: 'HTML' },
        );
        await ctx.reply('✅ Javob yuborildi!', adminMainKeyboard());
      } catch {
        await ctx.reply("❌ Foydalanuvchiga xabar yuborib bo'lmadi (bot bloklangandir).", adminMainKeyboard());
      }
      return;
    }

    if (session.action === 'broadcast' && session.step === 'message') {
      this.adminSessions.delete(userId);
      const users = await this.usersService.getAllUsers();
      let sent = 0, failed = 0;
      await ctx.reply(`📢 Yuborish boshlandi... (${users.length} ta foydalanuvchi)`);
      for (const user of users) {
        try {
          await this.bot.telegram.sendMessage(user.telegramId, text);
          sent++;
          await new Promise((r) => setTimeout(r, 35));
        } catch { failed++; }
      }
      const kb = this.isSuperAdmin(userId) ? superAdminMainKeyboard() : adminMainKeyboard();
      await ctx.reply(`✅ Tayyor!\n✔️ Yuborildi: ${sent}\n❌ Xato: ${failed}`, kb);
      return;
    }

    if (session.action === 'add_admin' && session.step === 'id') {
      this.adminSessions.delete(userId);
      const targetId = parseInt(text.trim());
      if (isNaN(targetId)) {
        await ctx.reply("❌ Noto'g'ri ID. Faqat raqam kiriting.", superAdminMainKeyboard());
        return;
      }
      if (targetId === this.superAdminId) {
        await ctx.reply("⚠️ Bu asosiy admin — o'zgartirib bo'lmaydi.", superAdminMainKeyboard());
        return;
      }
      const targetUser = await this.usersService.findByTelegramId(targetId);
      if (!targetUser) {
        await ctx.reply(
          `❌ ID <code>${targetId}</code> bo'lgan foydalanuvchi topilmadi.\n\nFoydalanuvchi botga /start bosgan bo'lishi kerak.`,
          { parse_mode: 'HTML', ...superAdminMainKeyboard() },
        );
        return;
      }
      await this.usersService.setAdmin(targetId, true);
      const name = this.escapeHtml(
        [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || 'Nomsiz'
      );
      await ctx.reply(
        `✅ <b>${name}</b> (ID: <code>${targetId}</code>) admin qilindi!`,
        { parse_mode: 'HTML', ...superAdminMainKeyboard() },
      );
      try {
        await this.bot.telegram.sendMessage(targetId, "🎉 Siz admin huquqiga ega bo'ldingiz! /start bosing.");
      } catch {}
    }
  }

  private async askLocation(ctx: Context) {
    await ctx.reply(
      "📍 Manzil nomini kiriting (masalan: Toshkent, Chilonzor 5-uy)",
      { reply_markup: { inline_keyboard: [[{ text: "⏭ Manzilsiz o'tkazib yuborish", callback_data: 'admin_skip_location_all' }]] } },
    );
  }

  private async saveProduct(ctx: Context) {
    const userId = ctx.from.id;
    const session = this.adminSessions.get(userId);
    if (!session) return;

    try {
      const product = await this.productsService.create({
        name: session.name,
        nameRu: session.nameRu || undefined,
        nameEn: session.nameEn || undefined,
        description: session.description,
        descriptionRu: session.descriptionRu || undefined,
        descriptionEn: session.descriptionEn || undefined,
        photos: session.photos || [],
        phoneNumber: session.phone || undefined,
        location: session.location || undefined,
        locationName: session.locationName || undefined,
        price: session.price || undefined,
        categoryId: session.categoryId,
      });

      this.adminSessions.delete(userId);

      let text = `✅ <b>Mahsulot saqlandi!</b>\n\n📦 <b>${this.escapeHtml(product.name)}</b>\n${this.escapeHtml(product.description)}`;
      if (product.price) text += `\n💰 Narxi: ${this.escapeHtml(product.price)}`;
      if (product.phoneNumber) text += `\n📞 Tel: <code>${this.escapeHtml(product.phoneNumber)}</code>`;
      if (product.locationName) text += `\n📍 Manzil: ${this.escapeHtml(product.locationName)}`;

      await ctx.reply(text, { parse_mode: 'HTML', ...adminMainKeyboard() });

      const users = await this.usersService.getAllUsers();
      let notifSent = 0;
      for (const user of users) {
        try {
          await this.bot.telegram.sendMessage(
            user.telegramId,
            `🆕 Yangi mahsulot: <b>${this.escapeHtml(product.name)}</b>`,
            {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: "👁 Ko'rish", callback_data: `prod_${product._id}` }]] },
            },
          );
          notifSent++;
          await new Promise((r) => setTimeout(r, 35));
        } catch {}
      }
      if (notifSent > 0) await ctx.reply(`📢 ${notifSent} ta foydalanuvchiga xabarnoma yuborildi!`);
    } catch (err) {
      this.logger.error('Mahsulot saqlashda xato:', err);
      await ctx.reply("❌ Mahsulot saqlashda xato yuz berdi. Qaytadan urinib ko'ring.", adminMainKeyboard());
      this.adminSessions.delete(userId);
    }
  }

  private async saveEditedProduct(ctx: Context, session: any) {
    const userId = ctx.from.id;
    try {
      const updateData: any = {};
      if (session.photos?.length) updateData.photos = session.photos;
      if (session.name !== undefined) updateData.name = session.name;
      if (session.description !== undefined) updateData.description = session.description;
      if (session.price !== undefined) updateData.price = session.price;
      if (session.phoneNumber !== undefined) updateData.phoneNumber = session.phoneNumber;
      if (session.locationName !== undefined) updateData.locationName = session.locationName;

      if (Object.keys(updateData).length === 0) {
        await ctx.reply("⚠️ Hech narsa o'zgartirilmadi.", adminMainKeyboard());
        this.adminSessions.delete(userId);
        return;
      }

      await this.productsService.update(session.productId, updateData);
      this.adminSessions.delete(userId);

      const prod = await this.productsService.findById(session.productId);
      await ctx.reply(
        `✅ <b>${this.escapeHtml(prod?.name || 'Mahsulot')}</b> yangilandi!`,
        { parse_mode: 'HTML', ...adminMainKeyboard() },
      );
    } catch (err) {
      this.logger.error('Mahsulot tahrirlashda xato:', err);
      await ctx.reply('❌ Xato yuz berdi.', adminMainKeyboard());
      this.adminSessions.delete(userId);
    }
  }
}