# WhatsApp Sipariş Botu (Claude API + Baileys)

Bu bot, WhatsApp hesabınıza gelen müşteri mesajlarını Claude API ile yanıtlar,
ürün kataloğunuza göre sohbet eder ve sipariş tamamlandığında otomatik olarak
`data/orders.json` dosyasına kaydeder.

## 1. VPS'e kurulum

VPS'inize SSH ile bağlanın (Ubuntu 22.04+ öneriyoruz), sonra:

```bash
# Node.js 20 kurulumu (yoksa)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Proje dosyalarını sunucuya yükleyin (scp, git, vs.) sonra:
cd whatsapp-siparis-bot
npm install
```

## 2. Claude API anahtarınızı ekleyin

```bash
cp .env.example .env
nano .env
```

`ANTHROPIC_API_KEY` satırına https://console.anthropic.com adresinden aldığınız
anahtarı yapıştırın. `BUSINESS_NAME` alanına işletmenizin adını yazın.

## 3. Ürün kataloğunuzu düzenleyin

`data/products.json` dosyasını kendi ürünleriniz, fiyatlarınız ve varyantlarınızla
(beden, renk vb.) güncelleyin. Bot yalnızca bu listedeki ürünleri satacak ve
fiyat uydurmayacak şekilde ayarlandı.

## 4. Botu başlatın

```bash
npm start
```

Terminalde bir **QR kod** çıkacak. Telefonunuzdan:

> WhatsApp > Ayarlar > Bağlı Cihazlar > Cihaz Bağla

yolunu izleyip bu QR kodu taratın. Bağlantı kurulunca bot otomatik çalışmaya
başlar — gelen her mesaj Claude'a gidip yanıt olarak geri döner.

## 5. Sürekli çalışır durumda tutmak (VPS'te)

Terminali kapatınca bot da durur. Arka planda sürekli çalışması için `pm2`
kullanmanızı öneririz:

```bash
sudo npm install -g pm2
pm2 start index.js --name siparis-bot
pm2 save
pm2 startup   # sunucu yeniden başlayınca botun da otomatik açılması için
```

Logları görmek için: `pm2 logs siparis-bot`

## 6. Siparişleri görüntülemek

Her yeni sipariş `data/orders.json` dosyasına eklenir. Örnek:

```json
{
  "telefon": "905xxxxxxxxx",
  "musteri_adi": "Ahmet",
  "urunler": [{ "isim": "Klasik Tişört", "adet": 2, "varyant": "M", "birim_fiyat": 350 }],
  "toplam_tutar": 700,
  "teslimat_adresi": "...",
  "tarih": "2026-09-21T10:00:00.000Z"
}
```

Bu dosyayı düzenli olarak bir Excel/Sheets'e aktarmak isterseniz bana haber
verin, o adımı da ekleyebilirim.

## 7. Telegram bildirimlerini açmak (isteğe bağlı)

Yeni bir sipariş geldiğinde Telegram'a otomatik bildirim düşmesini istiyorsanız:

1. Telegram'da **@BotFather**'a yazın, `/newbot` komutuyla yeni bir bot oluşturun.
   Size bir **token** verecek (örn. `123456:ABC-DEF...`) — bunu `TELEGRAM_BOT_TOKEN`
   olarak `.env` dosyanıza yapıştırın.
2. Kendi **chat ID**'nizi öğrenmek için Telegram'da **@userinfobot**'a yazın,
   size ID'nizi (bir sayı) gösterecek — bunu `TELEGRAM_CHAT_ID` olarak yapıştırın.
3. Oluşturduğunuz bota Telegram'dan **bir kere** `/start` yazın (aksi halde bot
   size mesaj gönderemez).
4. `.env` dosyasını kaydedip botu yeniden başlatın (`pm2 restart siparis-bot`
   ya da `npm start`).

Bundan sonra her onaylanan siparişte Telegram'a otomatik özet mesajı düşer.
Birden fazla kişiye/gruba bildirim gitsin isterseniz haber verin, kolayca
ekleriz.

## Ücretsiz test seçenekleri (VPS almadan önce)

- **Kendi bilgisayarınızda:** `npm start` ile direkt çalışır, tek fark
  bilgisayarın açık ve internete bağlı kalması gerekir. Test için en kolay yol.
- **Oracle Cloud Free Tier:** Süresiz ücretsiz bir VPS sunuyor ("Always Free"
  kategorisi). Kredi kartı istenir ama ücretlendirilmez. Kalıcı çözüm
  istiyorsanız iyi bir seçenek — isterseniz kurulumunu adım adım anlatırım.

## Önemli notlar

- **Bu yöntem (Baileys) WhatsApp'ın resmi API'si değildir.** WhatsApp Web
  protokolünü taklit eder. Bu yüzden:
  - Aşırı otomatik/toplu mesajlaşma hesabınızın kısıtlanmasına yol açabilir.
  - Kişisel/test amaçlı ve düşük-orta hacimli kullanım için uygundur.
  - Ciddi ticari hacimde ve garanti istiyorsanız resmi **WhatsApp Business
    API**'ye (Meta onaylı bir sağlayıcı üzerinden) geçmeniz gerekir.
- `auth_info/` klasörü WhatsApp oturum bilgilerinizi tutar — bunu kimseyle
  paylaşmayın, hesabınıza tam erişim sağlar.
- Claude API kullanımı ücretlidir (mesaj başına küçük bir maliyet). Güncel
  fiyatlandırma için: https://docs.claude.com
