import { Markup } from 'telegraf';
import { t, Lang } from './i18n';

export function mainMenuKeyboard(lang: Lang) {
  return Markup.keyboard([
    [t(lang, 'categories'), t(lang, 'search')],
    [t(lang, 'favorites'), t(lang, 'askAdmin')],
    [t(lang, 'callBtn'), t(lang, 'locationBtn')],
    ['🌐 Til / Язык / Language'],
  ]).resize();
}

export function cancelKeyboard(lang: Lang) {
  return Markup.keyboard([[t(lang, 'cancelBtn')]]).resize();
}

export function categoriesInlineKeyboard(categories: any[], lang: Lang, counts?: Record<string, number>) {
  const buttons = categories.map((cat) => {
    const name = lang === 'ru' && cat.nameRu ? cat.nameRu
      : lang === 'en' && cat.nameEn ? cat.nameEn
      : cat.name;
    const emoji = cat.emoji ? `${cat.emoji} ` : '';
    const count = counts ? ` (${counts[cat._id.toString()] ?? 0})` : '';
    return [Markup.button.callback(`${emoji}${name}${count}`, `cat_${cat._id}`)];
  });
  return Markup.inlineKeyboard(buttons);
}

export function productsInlineKeyboard(products: any[], lang: Lang, backCatId: string) {
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;

  const buttons = products.map((p) => {
    const name = lang === 'ru' && p.nameRu ? p.nameRu
      : lang === 'en' && p.nameEn ? p.nameEn
      : p.name;
    const isNew = p.createdAt && (now - new Date(p.createdAt).getTime()) < threeDays;
    const newBadge = isNew ? '🆕 ' : '';
    return [Markup.button.callback(`${newBadge}${name}`, `prod_${p._id}`)];
  });
  buttons.push([Markup.button.callback(`⬅️ ${t(lang, 'backToCategories')}`, `cat_${backCatId}`)]);
  return Markup.inlineKeyboard(buttons);
}

export function productDetailKeyboard(product: any, lang: Lang, isFavorite: boolean) {
  const buttons: any[] = [];

  const hasPhone = !!product.phoneNumber;
  const hasLocation = !!product.location || !!product.locationName;

  if (hasPhone && hasLocation) {
    // Ikkalasi bor — birlashtirilgan tugma
    buttons.push([Markup.button.callback('📞 Tel & 📍 Manzil', `contact_${product._id}`)]);
  } else if (hasPhone) {
    // Faqat telefon
    buttons.push([Markup.button.callback(t(lang, 'callNumber'), `call_${product._id}`)]);
  } else if (hasLocation) {
    // Faqat manzil
    buttons.push([Markup.button.callback(t(lang, 'viewLocation'), `loc_${product._id}`)]);
  }

  const favText = isFavorite ? t(lang, 'removeFavorite') : t(lang, 'addFavorite');
  buttons.push([Markup.button.callback(favText, `fav_${product._id}`)]);
  buttons.push([Markup.button.callback(t(lang, 'shareProduct'), `share_${product._id}`)]);

  if (product.categoryId) {
    buttons.push([Markup.button.callback(`⬅️ ${t(lang, 'backToProducts')}`, `cat_${product.categoryId}`)]);
  }

  return Markup.inlineKeyboard(buttons);
}

export function languageKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🇺🇿 O'zbekcha", 'lang_uz'),
      Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      Markup.button.callback('🇬🇧 English', 'lang_en'),
    ],
  ]);
}

// Admin keyboards
export function adminMainKeyboard() {
  return Markup.keyboard([
    ["➕ Kategoriya qo'sh", "📦 Mahsulot qo'sh"],
    ['📋 Kategoriyalar', '📦 Mahsulotlar'],
    ['📊 Statistika', '📢 Xabar yuborish'],
    ['👥 Foydalanuvchilar', '🏠 Bosh menyu'],
  ]).resize();
}

export function superAdminMainKeyboard() {
  return Markup.keyboard([
    ["➕ Kategoriya qo'sh", "📦 Mahsulot qo'sh"],
    ['📋 Kategoriyalar', '📦 Mahsulotlar'],
    ['📊 Statistika', '📢 Xabar yuborish'],
    ['👥 Foydalanuvchilar', '👑 Adminlar'],
    ['🏠 Bosh menyu'],
  ]).resize();
}

export function adminCategoryActions(catId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ Tahrirlash', `admin_edit_cat_${catId}`),
      Markup.button.callback("🗑️ O'chirish", `admin_del_cat_${catId}`),
    ],
    [Markup.button.callback("➕ Mahsulot qo'sh", `admin_add_prod_${catId}`)],
  ]);
}

export function adminProductActions(prodId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ Tahrirlash', `admin_edit_prod_${prodId}`),
      Markup.button.callback("🗑️ O'chirish", `admin_del_prod_${prodId}`),
    ],
  ]);
}

export function confirmDeleteKeyboard(type: string, id: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Ha, o'chir", `confirm_del_${type}_${id}`),
      Markup.button.callback("❌ Yo'q", 'cancel_action'),
    ],
  ]);
}

export function usersPageKeyboard(page: number, totalPages: number) {
  const buttons: any[] = [];
  const nav: any[] = [];
  if (page > 1) nav.push(Markup.button.callback('⬅️ Oldingi', `users_page_${page - 1}`));
  nav.push(Markup.button.callback(`${page}/${totalPages}`, 'noop'));
  if (page < totalPages) nav.push(Markup.button.callback('Keyingi ➡️', `users_page_${page + 1}`));
  if (nav.length) buttons.push(nav);
  return Markup.inlineKeyboard(buttons);
}
