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
  confirmDeleteKeyboard, usersPageKeyboard,
} from './keyboards';

@Injectable()
export class BotService implements OnModuleInit {
  private bot: Telegraf;
  private readonly logger = new Logger(BotService.name);
  private adminIds: number[];
  private adminSessions: Map<number, any> = new Map();

  constructor(
    private config: ConfigService,
    private usersService: UsersService,
    private categoriesService: CategoriesService,
    private productsService: ProductsService,
  ) {
    this.bot = new Telegraf(this.config.get('BOT_TOKEN'));
    this.adminIds = (this.config.get('ADMIN_IDS') || '')
      .split(',').map((id: string) => parseInt(id.trim())).filter(Boolean);
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
  isAdmin(userId: number): boolean { return this.adminIds.includes(userId); }

  private async getUserLang(ctx: Context): Promise<Lang> {
    const tgUser = ctx.from;
    if (!tgUser) return 'uz';
    const user = await this.usersService.findByTelegramId(tgUser.id);
    return (user?.language as Lang) || 'uz';
  }

  private async safeEditMessage(ctx: Context, text: string, extra: any = {}) {
    try {
      const msg = (ctx as any).callbackQuery?.message;
      if (msg && (msg.photo || msg.video || msg.document || msg.audio)) {
        await ctx.editMessageCaption(text, { parse_mode: 'Markdown', ...extra });
      } else {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...extra });
      }
    } catch {
      await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
    }
  }

  private registerHandlers() {
    // /start
    this.bot.start(async (ctx) => {
      const tgUser = ctx.from;
      const user = await this.usersService.findOrCreate(tgUser);
      const lang = user.language as Lang;

      // Deep link: /start prod_<id>
      const payload = (ctx as any).startPayload as string;
      if (payload?.startsWith('prod_')) {
        const prodId = payload.replace('prod_', '');
        const product = await this.productsService.findById(prodId);
        if (product) {
          await this.productsService.incrementView(prodId);
          const isFav = user.favorites.includes(prodId);

          const name = lang === 'ru' && product.nameRu ? product.nameRu
            : lang === 'en' && product.nameEn ? product.nameEn : product.name;
          const desc = lang === 'ru' && product.descriptionRu ? product.descriptionRu
            : lang === 'en' && product.descriptionEn ? product.descriptionEn : product.description;

          let text = `*${name}*\n\n${desc}`;
          if (product.price) text += `\n\n💰 *${t(lang, 'price')}:* ${product.price}`;
          if (product.phoneNumber) text += `\n📞 *${t(lang, 'phone')}:* \`${product.phoneNumber}\``;
          if (product.locationName) text += `\n📍 *${t(lang, 'address')}:* ${product.locationName}`;
          text += `\n\n👁 ${t(lang, 'views')}: ${product.viewCount + 1}`;

          const keyboard = productDetailKeyboard(product, lang, isFav);

          if (product.photos?.length) {
            await ctx.replyWithPhoto(product.photos[0], {
              caption: text,
              parse_mode: 'Markdown',
              ...keyboard,
            });
          } else {
            await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
          }

          // Asosiy menyu ham ko'rsatamiz
          if (!this.isAdmin(tgUser.id)) {
            await ctx.reply(t(lang, 'backToMenu'), mainMenuKeyboard(lang));
          }
          return;
        }
      }

      // Oddiy /start
      if (this.isAdmin(tgUser.id)) {
        await ctx.reply('👑 Admin paneliga xush kelibsiz!', adminMainKeyboard());
      } else {
        await ctx.reply(t(lang, 'welcome', user.firstName), mainMenuKeyboard(lang));
      }
    });

    // Til tanlash
    this.bot.hears('🌐 Til / Язык / Language', async (ctx) => {
      const lang = await this.getUserLang(ctx);
      await ctx.reply(t(lang, 'selectLanguage'), languageKeyboard());
    });

    // Bosh menyu
    this.bot.hears(['🏠 Bosh menyu', '🏠 Главное меню', '🏠 Main Menu'], async (ctx) => {
      const lang = await this.getUserLang(ctx);
      await this.usersService.setState(ctx.from.id, 'idle');
      this.adminSessions.delete(ctx.from.id);
      if (this.isAdmin(ctx.from.id)) {
        await ctx.reply('Admin panel:', adminMainKeyboard());
      } else {
        await ctx.reply(t(lang, 'backToMenu'), mainMenuKeyboard(lang));
      }
    });

    // ============ USER FLOWS ============

    this.bot.hears(['📂 Kategoriyalar', '📂 Категории', '📂 Categories'], async (ctx) => {
      if (this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      const categories = await this.categoriesService.getAll();
      if (!categories.length) return ctx.reply(t(lang, 'noCategories'));

      // Har bir kategoriya uchun mahsulot sonini olish
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
      if (this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      await this.usersService.setState(ctx.from.id, 'searching');
      await ctx.reply(t(lang, 'searchPrompt'), cancelKeyboard(lang));
    });

    this.bot.hears(['⭐ Sevimlilar', '⭐ Избранное', '⭐ Favorites'], async (ctx) => {
      if (this.isAdmin(ctx.from.id)) return;
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
      if (this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      await this.usersService.setState(ctx.from.id, 'waiting_question');
      await ctx.reply(t(lang, 'askAdminPrompt'), cancelKeyboard(lang));
    });

    // User: Aloqa ma'lumotlari (Tel & Manzil) — eski birlashtrilgan tugma
    this.bot.hears(
      ['📞 Aloqa & 📍 Manzil', '📞 Контакт & 📍 Адрес', '📞 Contact & 📍 Location'],
      async (ctx) => {
        if (this.isAdmin(ctx.from.id)) return;
        await this.sendContactInfo(ctx);
      },
    );

    // User: alohida Telefon tugmasi
    this.bot.hears(['📞 Telefon', '📞 Телефон', '📞 Phone'], async (ctx) => {
      if (this.isAdmin(ctx.from.id)) return;
      await this.sendContactInfo(ctx);
    });

    // User: alohida Manzil tugmasi
    this.bot.hears(['📍 Manzil', '📍 Адрес', '📍 Location'], async (ctx) => {
      if (this.isAdmin(ctx.from.id)) return;
      const lang = await this.getUserLang(ctx);
      const contactAddress = this.config.get('CONTACT_ADDRESS') || '';
      const contactLat = parseFloat(this.config.get('CONTACT_LAT') || '0');
      const contactLng = parseFloat(this.config.get('CONTACT_LNG') || '0');

      if (!contactAddress && !contactLat) {
        return ctx.reply(t(lang, 'noContactInfo'));
      }

      if (contactAddress) {
        await ctx.reply(`📍 *${t(lang, 'address')}:* ${contactAddress}`, { parse_mode: 'Markdown' });
      }
      if (contactLat && contactLng) {
        await ctx.replyWithLocation(contactLat, contactLng);
      }
    });

    // ============ CALLBACK QUERIES ============

    // Kategoriya tanlash
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
        await this.safeEditMessage(ctx, `${emoji}*${catName}*\n\n${t(lang, 'noProducts')}`);
        return ctx.answerCbQuery();
      }

      const text = `${emoji}*${catName}*\n\n${t(lang, 'selectProduct')}`;
      await this.safeEditMessage(ctx, text, productsInlineKeyboard(products, lang, catId));
      await ctx.answerCbQuery();
    });

    // Mahsulot ko'rish
    this.bot.action(/^prod_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const lang = await this.getUserLang(ctx);
      const product = await this.productsService.findById(prodId);
      if (!product) return ctx.answerCbQuery('Topilmadi');

      await this.productsService.incrementView(prodId);
      const user = await this.usersService.findByTelegramId(ctx.from.id);
      const isFav = user ? user.favorites.includes(prodId) : false;

      const name = lang === 'ru' && product.nameRu ? product.nameRu
        : lang === 'en' && product.nameEn ? product.nameEn : product.name;
      const desc = lang === 'ru' && product.descriptionRu ? product.descriptionRu
        : lang === 'en' && product.descriptionEn ? product.descriptionEn : product.description;

      const isNew = product.createdAt &&
        (Date.now() - new Date(product.createdAt).getTime()) < 3 * 24 * 60 * 60 * 1000;
      const newBadge = isNew ? '🆕 ' : '';

      let text = `${newBadge}*${name}*\n\n${desc}`;
      if (product.price) text += `\n\n💰 *${t(lang, 'price')}:* ${product.price}`;
      if (product.phoneNumber) text += `\n📞 *${t(lang, 'phone')}:* \`${product.phoneNumber}\``;
      if (product.locationName) text += `\n📍 *${t(lang, 'address')}:* ${product.locationName}`;
      text += `\n\n👁 ${t(lang, 'views')}: ${product.viewCount + 1}`;
      const keyboard = productDetailKeyboard(product, lang, isFav);

      try { await ctx.deleteMessage(); } catch {}

      if (product.photos?.length) {
        if (product.photos.length === 1) {
          await ctx.replyWithPhoto(product.photos[0], {
            caption: text,
            parse_mode: 'Markdown',
            ...keyboard,
          });
        } else {
          const media = product.photos.map((ph, i) => ({
            type: 'photo' as const,
            media: ph,
            ...(i === 0 ? { caption: text, parse_mode: 'Markdown' as const } : {}),
          }));
          await ctx.replyWithMediaGroup(media as any);
          await ctx.reply('👇 Amallar:', keyboard);
        }
      } else {
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      }
      await ctx.answerCbQuery();
    });

    // Telefon (alohida)
    this.bot.action(/^call_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const product = await this.productsService.findById(prodId);
      if (!product?.phoneNumber) return ctx.answerCbQuery(t(await this.getUserLang(ctx), 'noPhone'));
      await ctx.answerCbQuery();
      await ctx.reply(`📞 *${product.name}*\n\n${t(await this.getUserLang(ctx), 'phone')}: \`${product.phoneNumber}\``, { parse_mode: 'Markdown' });
    });

    // Lokatsiya (alohida)
    this.bot.action(/^loc_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const product = await this.productsService.findById(prodId);
      if (!product?.location && !product?.locationName) return ctx.answerCbQuery(t(await this.getUserLang(ctx), 'noLocation'));
      await ctx.answerCbQuery();
      if (product.location) {
        const [lat, lng] = product.location.split(',').map(Number);
        if (lat && lng) {
          await ctx.replyWithLocation(lat, lng);
          if (product.locationName) await ctx.reply(`📍 ${product.locationName}`);
          return;
        }
      }
      if (product.locationName) await ctx.reply(`📍 ${product.locationName}`);
    });

    // Tel & Manzil birga
    this.bot.action(/^contact_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const product = await this.productsService.findById(prodId);
      if (!product) return ctx.answerCbQuery('Topilmadi');
      await ctx.answerCbQuery();

      const lang = await this.getUserLang(ctx);
      let text = `📋 *${product.name}*\n\n`;
      if (product.phoneNumber) text += `📞 *${t(lang, 'phone')}:* \`${product.phoneNumber}\`\n`;
      if (product.locationName) text += `📍 *${t(lang, 'address')}:* ${product.locationName}\n`;

      await ctx.reply(text, { parse_mode: 'Markdown' });

      if (product.location) {
        const [lat, lng] = product.location.split(',').map(Number);
        if (lat && lng) await ctx.replyWithLocation(lat, lng);
      }
    });

    // Sevimli toggle
    this.bot.action(/^fav_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      const lang = await this.getUserLang(ctx);
      const added = await this.usersService.toggleFavorite(ctx.from.id, prodId);
      await ctx.answerCbQuery(added ? t(lang, 'addedFavorite') : t(lang, 'removedFavorite'));
    });

    // Ulashish
    this.bot.action(/^share_(.+)$/, async (ctx) => {
      const prodId = ctx.match[1];
      await ctx.answerCbQuery();
      const botInfo = await this.bot.telegram.getMe();
      await ctx.reply(`📤 Ushbu mahsulotni ulashing:\nhttps://t.me/${botInfo.username}?start=prod_${prodId}`);
    });

    // Til
    this.bot.action(/^lang_(uz|ru|en)$/, async (ctx) => {
      const lang = ctx.match[1] as Lang;
      await this.usersService.setLanguage(ctx.from.id, lang);
      await ctx.answerCbQuery(t(lang, 'languageChanged'));
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply(t(lang, 'welcome', ctx.from.first_name), mainMenuKeyboard(lang));
    });

    // Admin: userni savoliga javob berish
    this.bot.action(/^reply_(\d+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const targetUserId = parseInt(ctx.match[1]);
      await ctx.answerCbQuery();

      this.adminSessions.set(ctx.from.id, {
        action: 'reply_to_user',
        targetUserId,
        step: 'message',
      });

      await ctx.reply(
        `📨 *User #${targetUserId}* ga javob yozing:`,
        { parse_mode: 'Markdown', ...cancelKeyboard('uz') },
      );
    });

    // ============ ADMIN FLOWS ============

    this.bot.hears("➕ Kategoriya qo'sh", async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      this.adminSessions.set(ctx.from.id, { action: 'add_category', step: 'name' });
      await ctx.reply(
        "📝 Kategoriya nomini kiriting:\n\nNamuna: 🏠 Uy jihozlari\n(Emoji qo'shsangiz avtomatik ajratiladi)",
        cancelKeyboard('uz'),
      );
    });

    this.bot.hears("📦 Mahsulot qo'sh", async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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

    // Admin: kategoriyalar ro'yxati
    this.bot.hears('📋 Kategoriyalar', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const categories = await this.categoriesService.getAllForAdmin();
      if (!categories.length) return ctx.reply("Kategoriyalar yo'q.");

      let text = '📋 *Kategoriyalar ro\'yxati:*\n\n';
      categories.forEach((cat, i) => {
        const status = cat.isActive ? '✅' : '❌';
        text += `${i + 1}. ${status} ${cat.emoji || ''} *${cat.name}*  (👁 ${cat.viewCount})\n`;
      });

      const buttons = categories.map((cat) => [
        { text: `${cat.emoji || ''} ${cat.name}`, callback_data: `admin_cat_menu_${cat._id}` },
      ]);

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
    });

    // Admin: kategoriya menyu
    this.bot.action(/^admin_cat_menu_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const catId = ctx.match[1];
      const cat = await this.categoriesService.findById(catId);
      if (!cat) return ctx.answerCbQuery('Topilmadi');
      await ctx.answerCbQuery();
      await ctx.reply(
        `${cat.emoji || ''} *${cat.name}*\nNima qilmoqchisiz?`,
        { parse_mode: 'Markdown', ...adminCategoryActions(catId) },
      );
    });

    // Admin: mahsulotlar ro'yxati
    this.bot.hears('📦 Mahsulotlar', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const products = await this.productsService.getAllForAdmin();
      if (!products.length) return ctx.reply("Mahsulotlar yo'q.");

      let text = '📦 *Mahsulotlar ro\'yxati:*\n\n';
      products.forEach((prod, i) => {
        const status = prod.isActive ? '✅' : '❌';
        text += `${i + 1}. ${status} *${prod.name}*`;
        if (prod.price) text += ` — ${prod.price}`;
        text += `  (👁 ${prod.viewCount})\n`;
      });

      const buttons = products.map((prod) => [
        { text: prod.name, callback_data: `admin_prod_menu_${prod._id}` },
      ]);

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
    });

    // Admin: mahsulot menyu
    this.bot.action(/^admin_prod_menu_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const prodId = ctx.match[1];
      const prod = await this.productsService.findById(prodId);
      if (!prod) return ctx.answerCbQuery('Topilmadi');
      await ctx.answerCbQuery();
      await ctx.reply(
        `📦 *${prod.name}*\nNima qilmoqchisiz?`,
        { parse_mode: 'Markdown', ...adminProductActions(prodId) },
      );
    });

    // Admin: mahsulot tahrirlash boshlash
    this.bot.action(/^admin_edit_prod_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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
        `✏️ *${prod.name}* — Nimani tahrirlamoqchisiz?`,
        {
          parse_mode: 'Markdown',
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

    // Admin: kategoriya tahrirlash boshlash
    this.bot.action(/^admin_edit_cat_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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
        `✏️ *${cat.name}* — Yangi nomini kiriting:\n\nNamuna: 🏠 Uy jihozlari`,
        { parse_mode: 'Markdown', ...cancelKeyboard('uz') },
      );
    });

    // Admin: tahrirlash field tanlash
    this.bot.action(/^admin_edit_field_(name|desc|price|phone|locname|photos)_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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

    // Admin: tahrirlash rasmlar tayyor
    this.bot.action('admin_edit_photos_done', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session || session.action !== 'edit_product') return;
      await ctx.answerCbQuery();
      await this.saveEditedProduct(ctx, session);
    });

    // Admin: foydalanuvchilar ro'yxati
    this.bot.hears("👥 Foydalanuvchilar", async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      await this.sendUsersPage(ctx, 1);
    });

    // Admin: foydalanuvchilar paginatsiya callback
    this.bot.action(/^users_page_(\d+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const page = parseInt(ctx.match[1]);
      await ctx.answerCbQuery();
      await this.sendUsersPage(ctx, page, true);
    });

    this.bot.action('noop', async (ctx) => ctx.answerCbQuery());

    // Statistika
    this.bot.hears('📊 Statistika', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const [userCount, activeUsers, catCount, prodCount, topProducts] = await Promise.all([
        this.usersService.getUserCount(),
        this.usersService.getActiveUserCount(),
        this.categoriesService.getCount(),
        this.productsService.getCount(),
        this.productsService.getTopViewed(),
      ]);
      let text = `📊 *Bot Statistikasi*\n\n`;
      text += `👤 Jami foydalanuvchilar: *${userCount}*\n`;
      text += `✅ Aktiv: *${activeUsers}*\n`;
      text += `📂 Kategoriyalar: *${catCount}*\n`;
      text += `📦 Mahsulotlar: *${prodCount}*\n\n`;
      text += `🔥 *Eng ko'p ko'rilgan:*\n`;
      topProducts.forEach((p, i) => {
        text += `${i + 1}. ${p.name} — ${p.viewCount} ko'rishlar\n`;
      });
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // Broadcast
    this.bot.hears('📢 Xabar yuborish', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      this.adminSessions.set(ctx.from.id, { action: 'broadcast', step: 'message' });
      await ctx.reply(
        "📢 Barcha foydalanuvchilarga yubormoqchi bo'lgan xabaringizni yozing:",
        cancelKeyboard('uz'),
      );
    });

    // Admin kategoriya tanlash (callback)
    this.bot.action(/^admin_choose_cat_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const catId = ctx.match[1];
      const session = this.adminSessions.get(ctx.from.id) || { action: 'add_product' };
      session.categoryId = catId;
      session.step = 'name';
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply('📝 Mahsulot nomini kiriting:');
    });

    // Admin: kategoriyadan mahsulot qo'shish
    this.bot.action(/^admin_add_prod_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const catId = ctx.match[1];
      this.adminSessions.set(ctx.from.id, {
        action: 'add_product',
        step: 'name',
        categoryId: catId,
      });
      await ctx.answerCbQuery();
      await ctx.reply("📝 Mahsulot nomini kiriting:");
    });

    // O'chirish tasdiqlash
    this.bot.action(/^admin_del_cat_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const catId = ctx.match[1];
      await ctx.answerCbQuery();
      await ctx.reply("⚠️ Kategoriyani o'chirishni tasdiqlaysizmi?", confirmDeleteKeyboard('cat', catId));
    });

    this.bot.action(/^admin_del_prod_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const prodId = ctx.match[1];
      await ctx.answerCbQuery();
      await ctx.reply("⚠️ Mahsulotni o'chirishni tasdiqlaysizmi?", confirmDeleteKeyboard('prod', prodId));
    });

    this.bot.action(/^confirm_del_(cat|prod)_(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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

    // Rasmlar tayyor (qo'shish)
    this.bot.action('admin_photos_done', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      await ctx.answerCbQuery('✅ Rasmlar saqlandi!');

      if (session.action === 'add_product') {
        // Rasmlar qabul qilindi, endi saqlash
        await this.saveProduct(ctx);
      }
    });

    this.bot.action('admin_photos_clear', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.photos = [];
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery('🗑 Rasmlar tozalandi');
      await ctx.reply('🗑 Barcha rasmlar o\'chirildi.\n\n📸 Qaytadan rasm yuboring:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Rasmsiz saqlash", callback_data: 'admin_photos_done' }],
          ],
        },
      });
    });

    // Narxni o'tkazib yuborish -> foto bosqichiga o'tmasdan to'g'ridan saqlash
    this.bot.action('admin_skip_price', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.price = null;
      await ctx.answerCbQuery();

      if (session.action === 'add_product') {
        session.step = 'photos';
        this.adminSessions.set(ctx.from.id, session);
        await ctx.reply('📸 Mahsulot rasmini yuboring (bir nechta bo\'lishi mumkin):', {
          reply_markup: {
            inline_keyboard: [[{ text: "⏭ Rasmsiz saqlash", callback_data: 'admin_photos_done' }]],
          },
        });
      } else if (session.action === 'edit_product') {
        session.price = null;
        await this.saveEditedProduct(ctx, session);
      }
    });

    // Ko'p tillik skip actionlar
    this.bot.action('admin_skip_name_ru', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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
      if (!this.isAdmin(ctx.from.id)) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.step = 'description';
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await ctx.reply('📝 O\'zbek tilidagi tavsifini kiriting:');
    });

    this.bot.action('admin_skip_desc_ru', async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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
      if (!this.isAdmin(ctx.from.id)) return;
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

    // Telefon o'tkazib yuborish
    this.bot.action("admin_skip_phone_to_loc", async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
      const session = this.adminSessions.get(ctx.from.id);
      if (!session) return;
      session.phone = null;
      session.step = "location_name";
      this.adminSessions.set(ctx.from.id, session);
      await ctx.answerCbQuery();
      await this.askLocation(ctx);
    });

    // Manzilni o'tkazib yuborish
    this.bot.action("admin_skip_location_all", async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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

    // Koordinatani o'tkazib yuborish
    this.bot.action("admin_skip_coords", async (ctx) => {
      if (!this.isAdmin(ctx.from.id)) return;
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

    // Lokatsiya (Telegram location message)
    this.bot.on('location', async (ctx) => {
      const userId = ctx.from.id;
      if (!this.isAdmin(userId)) return;
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

    // ============ RASM XABARLARI ============

    this.bot.on('photo', async (ctx) => {
      const userId = ctx.from.id;
      if (!this.isAdmin(userId)) return;
      const session = this.adminSessions.get(userId);
      if (!session) return;

      // Yangi mahsulot yoki tahrirlash uchun rasm qabul qilish
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
        caption: `✅ *${count}-rasm qabul qilindi*\n\nJami: ${count} ta rasm\n\nYana rasm yuboring yoki saqlashni tasdiqlang:`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `✅ Saqlash (${count} ta rasm)`, callback_data: doneCallback }],
            [{ text: '🗑 Rasmlarni tozalash', callback_data: 'admin_photos_clear' }],
          ],
        },
      });
    });

    // ============ MATN XABARLARI ============

    this.bot.on('text', async (ctx) => {
      const userId = ctx.from.id;
      const text = ctx.message.text;

      // Bekor qilish
      if (text === '❌ Bekor qilish' || text === '❌ Отмена' || text === '❌ Cancel') {
        await this.usersService.setState(userId, 'idle');
        this.adminSessions.delete(userId);
        const lang = await this.getUserLang(ctx);
        if (this.isAdmin(userId)) return ctx.reply('❌ Bekor qilindi', adminMainKeyboard());
        return ctx.reply('❌ Bekor qilindi', mainMenuKeyboard(lang));
      }

      // Admin sessiyalari
      if (this.isAdmin(userId)) {
        const session = this.adminSessions.get(userId);
        if (session) return this.handleAdminSession(ctx, session, text);
        return;
      }

      // User holati
      const user = await this.usersService.findByTelegramId(userId);
      if (!user) return;
      await this.usersService.incrementMessage(userId);

      if (user.state === 'searching') return this.handleSearch(ctx, text, user.language as Lang);
      if (user.state === 'waiting_question') return this.handleUserQuestion(ctx, text, user);
    });
  }

  // ============ HELPER METHODS ============

  // Foydalanuvchilar ro'yxatini paginatsiya bilan yuborish
  private async sendUsersPage(ctx: Context, page: number, edit = false) {
    const limit = 10;
    const { users, total } = await this.usersService.getUsersPaginated(page, limit);
    const totalPages = Math.ceil(total / limit);

    let text = `👥 *Foydalanuvchilar ro'yxati* (${total} ta)\n`;
    text += `📄 Sahifa: ${page}/${totalPages}\n\n`;

    users.forEach((u, i) => {
      const num = (page - 1) * limit + i + 1;
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Nomsiz';
      const username = u.username ? ` @${u.username}` : '';
      const lang = u.language?.toUpperCase() || 'UZ';
      const blocked = u.isBlocked ? ' 🚫' : '';
      text += `${num}. *${name}*${username}\n`;
      text += `   🌐 ${lang} | 💬 ${u.messageCount || 0} xabar${blocked}\n\n`;
    });

    const keyboard = usersPageKeyboard(page, totalPages);

    if (edit) {
      try {
        await (ctx as any).editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
      } catch {
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      }
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
  }

  // Aloqa ma'lumotlarini yuborish
  private async sendContactInfo(ctx: Context) {
    const lang = await this.getUserLang(ctx);
    const contactPhone = this.config.get('CONTACT_PHONE') || '';
    const contactAddress = this.config.get('CONTACT_ADDRESS') || '';
    const contactLat = parseFloat(this.config.get('CONTACT_LAT') || '0');
    const contactLng = parseFloat(this.config.get('CONTACT_LNG') || '0');

    let text = `📋 *${t(lang, 'contactInfo')}*\n\n`;
    if (contactPhone) text += `📞 *${t(lang, 'phone')}:* \`${contactPhone}\`\n`;
    if (contactAddress) text += `📍 *${t(lang, 'address')}:* ${contactAddress}\n`;
    if (!contactPhone && !contactAddress) text += t(lang, 'noContactInfo');

    await ctx.reply(text, { parse_mode: 'Markdown' });

    if (contactLat && contactLng) {
      await ctx.replyWithLocation(contactLat, contactLng);
    }
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
        const userName = [user.firstName, user.lastName].filter(Boolean).join(' ');
        const userLink = user.username ? `@${user.username}` : `ID: ${user.telegramId}`;
        await this.bot.telegram.sendMessage(
          adminId,
          `📩 *Yangi savol!*\n\n👤 ${userName} (${userLink})\n\n❓ ${question}`,
          {
            parse_mode: 'Markdown',
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

    // ---- KATEGORIYA QO'SHISH ----
    if (session.action === 'add_category') {
      if (session.step === 'name') {
        const emojiMatch = text.match(/(\p{Emoji})/u);
        const name = emojiMatch ? text.replace(emojiMatch[1], '').trim() : text.trim();
        const emoji = emojiMatch ? emojiMatch[1] : '';
        await this.categoriesService.create({ name, emoji });
        this.adminSessions.delete(userId);
        await ctx.reply(
          `✅ Kategoriya qo'shildi!\n\n${emoji} *${name}*`,
          { parse_mode: 'Markdown', ...adminMainKeyboard() },
        );
      }
      return;
    }

    // ---- KATEGORIYA TAHRIRLASH ----
    if (session.action === 'edit_category') {
      if (session.step === 'name') {
        const emojiMatch = text.match(/(\p{Emoji})/u);
        const name = emojiMatch ? text.replace(emojiMatch[1], '').trim() : text.trim();
        const emoji = emojiMatch ? emojiMatch[1] : '';
        await this.categoriesService.update(session.categoryId, { name, emoji });
        this.adminSessions.delete(userId);
        await ctx.reply(
          `✅ Kategoriya yangilandi!\n\n${emoji} *${name}*`,
          { parse_mode: 'Markdown', ...adminMainKeyboard() },
        );
      }
      return;
    }

    // ---- MAHSULOT QO'SHISH ----
    if (session.action === 'add_product') {
      if (session.step === 'name') {
        session.name = text;
        session.step = 'name_ru';
        this.adminSessions.set(userId, session);
        await ctx.reply(
          '🇷🇺 Rus tilidagi nomini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_name_ru' }]] } },
        );
        return;
      }
      if (session.step === 'name_ru') {
        session.nameRu = text;
        session.step = 'name_en';
        this.adminSessions.set(userId, session);
        await ctx.reply(
          '🇬🇧 Ingliz tilidagi nomini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_name_en' }]] } },
        );
        return;
      }
      if (session.step === 'name_en') {
        session.nameEn = text;
        session.step = 'description';
        this.adminSessions.set(userId, session);
        await ctx.reply('📝 O\'zbek tilidagi tavsifini kiriting:');
        return;
      }
      if (session.step === 'description') {
        session.description = text;
        session.step = 'description_ru';
        this.adminSessions.set(userId, session);
        await ctx.reply(
          '🇷🇺 Rus tilidagi tavsifini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_desc_ru' }]] } },
        );
        return;
      }
      if (session.step === 'description_ru') {
        session.descriptionRu = text;
        session.step = 'description_en';
        this.adminSessions.set(userId, session);
        await ctx.reply(
          '🇬🇧 Ingliz tilidagi tavsifini kiriting (ixtiyoriy):',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_desc_en' }]] } },
        );
        return;
      }
      if (session.step === 'description_en') {
        session.descriptionEn = text;
        session.step = 'phone';
        this.adminSessions.set(userId, session);
        await ctx.reply(
          '📞 Telefon raqamini kiriting (ixtiyoriy):\n\nNamuna: +998901234567',
          { reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_phone_to_loc' }]] } },
        );
        return;
      }
      if (session.step === 'phone') {
        session.phone = text;
        session.step = 'location_name';
        this.adminSessions.set(userId, session);
        await this.askLocation(ctx);
        return;
      }
      if (session.step === 'location_name') {
        session.locationName = text;
        session.step = 'location_coords';
        this.adminSessions.set(userId, session);
        await ctx.reply(
          '📌 Telegram lokatsiya tugmasi orqali aniq joylashuvni yuboring yoki o\'tkazib yuboring:',
          {
            reply_markup: {
              inline_keyboard: [[{ text: "⏭ Koordinatasiz saqlash", callback_data: 'admin_skip_coords' }]],
            },
          },
        );
        return;
      }
      if (session.step === 'location_coords') {
        // Matn keldi — koordinatasiz davom etish
        session.location = null;
        session.step = 'price';
        this.adminSessions.set(userId, session);
        await ctx.reply('💰 Narxini kiriting (ixtiyoriy):', {
          reply_markup: {
            inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'admin_skip_price' }]],
          },
        });
        return;
      }
      if (session.step === 'price') {
        session.price = text;
        session.step = 'photos';
        this.adminSessions.set(userId, session);
        await ctx.reply('📸 Mahsulot rasmini yuboring (bir nechta bo\'lishi mumkin):', {
          reply_markup: {
            inline_keyboard: [[{ text: "⏭ Rasmsiz saqlash", callback_data: 'admin_photos_done' }]],
          },
        });
        return;
      }
      if (session.step === 'photos') {
        await ctx.reply('📸 Iltimos rasm yuboring yoki saqlashni tasdiqlang:', {
          reply_markup: {
            inline_keyboard: [[{ text: "⏭ Rasmsiz saqlash", callback_data: 'admin_photos_done' }]],
          },
        });
        return;
      }
    }

    // ---- MAHSULOT TAHRIRLASH ----
    if (session.action === 'edit_product') {
      const updateData: any = {};

      if (session.step === 'name') updateData.name = text;
      else if (session.step === 'desc') updateData.description = text;
      else if (session.step === 'price') updateData.price = text;
      else if (session.step === 'phone') updateData.phoneNumber = text;
      else if (session.step === 'locname') updateData.locationName = text;
      else if (session.step === 'photos') {
        // Rasm matn keldi, xabar bering
        await ctx.reply('📸 Iltimos rasm yuboring yoki saqlashni tasdiqlang:', {
          reply_markup: {
            inline_keyboard: [[{ text: "✅ Saqlash", callback_data: 'admin_edit_photos_done' }]],
          },
        });
        return;
      }

      if (Object.keys(updateData).length > 0) {
        await this.productsService.update(session.productId, updateData);
        this.adminSessions.delete(userId);
        const prod = await this.productsService.findById(session.productId);
        await ctx.reply(
          `✅ *${prod?.name || 'Mahsulot'}* yangilandi!`,
          { parse_mode: 'Markdown', ...adminMainKeyboard() },
        );
      }
      return;
    }

    // ---- USER GA JAVOB BERISH ----
    if (session.action === 'reply_to_user' && session.step === 'message') {
      const targetUserId = session.targetUserId;
      this.adminSessions.delete(userId);
      try {
        await this.bot.telegram.sendMessage(
          targetUserId,
          `📨 *Admin javob berdi:*\n\n${text}`,
          { parse_mode: 'Markdown' },
        );
        await ctx.reply('✅ Javob yuborildi!', adminMainKeyboard());
      } catch {
        await ctx.reply('❌ Foydalanuvchiga xabar yuborib bo\'lmadi (bot bloklangandir).', adminMainKeyboard());
      }
      return;
    }

    // ---- BROADCAST ----
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
      await ctx.reply(
        `✅ Tayyor!\n✔️ Yuborildi: ${sent}\n❌ Xato: ${failed}`,
        adminMainKeyboard(),
      );
    }
  }

  private async askLocation(ctx: Context) {
    await ctx.reply(
      '📍 Manzil nomini kiriting (masalan: Toshkent, Chilonzor 5-uy)',
      {
        reply_markup: {
          inline_keyboard: [[{ text: "⏭ Manzilsiz o'tkazib yuborish", callback_data: 'admin_skip_location_all' }]],
        },
      },
    );
  }

  // Yangi mahsulotni saqlash
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

      let text = `✅ *Mahsulot saqlandi!*\n\n📦 *${product.name}*\n${product.description}`;
      if (product.price) text += `\n💰 Narxi: ${product.price}`;
      if (product.phoneNumber) text += `\n📞 Tel: ${product.phoneNumber}`;
      if (product.locationName) text += `\n📍 Manzil: ${product.locationName}`;

      await ctx.reply(text, { parse_mode: 'Markdown', ...adminMainKeyboard() });

      // Foydalanuvchilarga xabarnoma
      const users = await this.usersService.getAllUsers();
      let notifSent = 0;
      for (const user of users) {
        try {
          await this.bot.telegram.sendMessage(
            user.telegramId,
            `🆕 Yangi mahsulot: *${product.name}*`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[{ text: "👁 Ko'rish", callback_data: `prod_${product._id}` }]],
              },
            },
          );
          notifSent++;
          await new Promise((r) => setTimeout(r, 35));
        } catch {}
      }
      if (notifSent > 0) {
        await ctx.reply(`📢 ${notifSent} ta foydalanuvchiga xabarnoma yuborildi!`);
      }
    } catch (err) {
      this.logger.error('Mahsulot saqlashda xato:', err);
      await ctx.reply('❌ Mahsulot saqlashda xato yuz berdi. Qaytadan urinib ko\'ring.', adminMainKeyboard());
      this.adminSessions.delete(userId);
    }
  }

  // Tahrirlangan mahsulotni saqlash (rasmlar)
  private async saveEditedProduct(ctx: Context, session: any) {
    const userId = ctx.from.id;
    try {
      const updateData: any = {};
      if (session.photos?.length) updateData.photos = session.photos;

      await this.productsService.update(session.productId, updateData);
      this.adminSessions.delete(userId);

      const prod = await this.productsService.findById(session.productId);
      await ctx.reply(
        `✅ *${prod?.name || 'Mahsulot'}* rasmlari yangilandi!`,
        { parse_mode: 'Markdown', ...adminMainKeyboard() },
      );
    } catch (err) {
      this.logger.error('Mahsulot tahrirlashda xato:', err);
      await ctx.reply('❌ Xato yuz berdi.', adminMainKeyboard());
      this.adminSessions.delete(userId);
    }
  }
}
