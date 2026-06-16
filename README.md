# 🤖 Telegram Katalog Bot

NestJS + MongoDB + Telegraf.js asosida qurilgan to'liq funksional Telegram katalog boti.

## ✨ Funksiyalar

### 👤 Foydalanuvchilar uchun
- 📂 **Kategoriyalar** — admin qo'shgan bo'limlarni ko'rish
- 📦 **Mahsulotlar** — har bir kategoriya ichidagi mahsulotlar
- 📸 **Rasmlar** — mahsulot rasmlari (bir yoki bir nechta)
- 📞 **Telefon** — mahsulotga bog'liq telefon raqami
- 📍 **Lokatsiya** — manzilni xaritada ko'rish
- ⭐ **Sevimlilar** — mahsulotlarni saqlash
- 🔍 **Qidiruv** — mahsulot bo'yicha qidiruv
- 📩 **Adminga savol** — to'g'ridan-to'g'ri admin bilan muloqot
- 📤 **Ulashish** — mahsulotni do'stga yuborish
- 🌐 **Ko'p til** — UZ / RU / EN

### 👑 Admin uchun
- ➕ Kategoriya qo'shish (emoji bilan)
- 📦 Mahsulot qo'shish (rasm, telefon, lokatsiya, narx)
- ✏️ Kategoriya/Mahsulot tahrirlash
- 🗑️ O'chirish (tasdiqlash bilan)
- 📊 Statistika (foydalanuvchilar, ko'rishlar, top mahsulotlar)
- 📢 Broadcast — barcha foydalanuvchilarga xabar yuborish
- 🔔 Yangi mahsulot xabarnomasi (avtomatik)
- 📨 Foydalanuvchi savollariga javob berish

## 🚀 O'rnatish

### 1. Kerakli narsalar
- Node.js 18+
- MongoDB (MongoDB Atlas tavsiya etiladi — bepul)
- Telegram Bot Token ([@BotFather](https://t.me/BotFather) dan)

### 2. O'rnatish

```bash
# Loyihani ko'chiring
cd telegram-bot

# Kutubxonalarni o'rnating
npm install

# .env fayl yarating
cp .env.example .env
```

### 3. .env faylni to'ldiring

```env
BOT_TOKEN=your_bot_token_here
MONGODB_URI=mongodb+srv://...
ADMIN_IDS=your_telegram_id
BOT_MODE=polling
```

**Telegram ID ni qanday bilish?** [@userinfobot](https://t.me/userinfobot) ga /start yuboring.

### 4. Ishga tushirish

```bash
# Development rejimida
npm run start:dev

# Production uchun
npm run build
npm run start:prod
```

## 📁 Loyiha tuzilmasi

```
src/
├── modules/
│   ├── bot/
│   │   ├── bot.service.ts    # Asosiy bot logikasi
│   │   ├── bot.module.ts
│   │   ├── i18n.ts           # Ko'p til tarjimalari
│   │   └── keyboards.ts      # Inline va reply klaviaturalar
│   ├── categories/
│   │   ├── category.schema.ts
│   │   ├── categories.service.ts
│   │   └── categories.module.ts
│   ├── products/
│   │   ├── product.schema.ts
│   │   ├── products.service.ts
│   │   └── products.module.ts
│   └── users/
│       ├── user.schema.ts
│       ├── users.service.ts
│       └── users.module.ts
├── app.module.ts
└── main.ts
```

## 🌐 Ko'p til qo'shish

`src/modules/bot/i18n.ts` faylida `translations` obyektiga yangi til qo'shing.

## 📦 MongoDB Atlas sozlash (bepul)

1. [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas) ga kiring
2. Bepul cluster yarating
3. Connection string'ni oling
4. `.env` dagi `MONGODB_URI` ga qo'shing

## 🔧 Qo'shimcha sozlamalar

### Webhook (production uchun)
```env
BOT_MODE=webhook
WEBHOOK_URL=https://yourdomain.com
```

### Bir nechta admin
```env
ADMIN_IDS=123456789,987654321,111222333
```

## 📸 Mahsulot qo'shish jarayoni (admin)

1. `📦 Mahsulot qo'sh` tugmasini bosing
2. Kategoriyani tanlang
3. Mahsulot nomini yozing
4. Tavsifni yozing
5. Rasm(lar) yuboring (ixtiyoriy)
6. Telefon raqamini kiriting (ixtiyoriy)
7. Manzilni kiriting (ixtiyoriy)
8. Narxini kiriting (ixtiyoriy)
9. ✅ Mahsulot saqlandi va barcha foydalanuvchilarga xabarнома yuborildi!
