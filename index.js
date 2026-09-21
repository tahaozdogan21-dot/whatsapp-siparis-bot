import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import Anthropic from '@anthropic-ai/sdk';
import * as baileysModule from '@whiskeysockets/baileys';

const makeWASocket =
  baileysModule.makeWASocket || baileysModule.default?.makeWASocket || baileysModule.default;
const useMultiFileAuthState =
  baileysModule.useMultiFileAuthState || baileysModule.default?.useMultiFileAuthState;
const DisconnectReason =
  baileysModule.DisconnectReason || baileysModule.default?.DisconnectReason;
const fetchLatestBaileysVersion =
  baileysModule.fetchLatestBaileysVersion || baileysModule.default?.fetchLatestBaileysVersion;


// ---------- Ayarlar ----------
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Mağazamız';
const PRODUCTS_PATH = path.join(process.cwd(), 'data', 'products.json');
const ORDERS_PATH = path.join(process.cwd(), 'data', 'orders.json');
const HISTORY_LIMIT = 20; // her müşteri için hafızada tutulan son mesaj sayısı

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

if (!fs.existsSync(ORDERS_PATH)) {
  fs.writeFileSync(ORDERS_PATH, '[]');
}

function loadProducts() {
  return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
}

function saveOrder(order) {
  const orders = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf-8'));
  const kayit = { ...order, tarih: new Date().toISOString() };
  orders.push(kayit);
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
  return kayit;
}

// Telegram'a sipariş bildirimi gönderir (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
// .env'de tanımlıysa). Tanımlı değilse sessizce atlar.
async function notifyTelegram(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const urunSatirlari = order.urunler
    .map((u) => `• ${u.isim}${u.varyant ? ` (${u.varyant})` : ''} x${u.adet} — ${u.birim_fiyat * u.adet} TL`)
    .join('\n');

  const mesaj = [
    '🛒 *Yeni Sipariş*',
    order.musteri_adi ? `Müşteri: ${order.musteri_adi}` : null,
    `Telefon: ${order.telefon}`,
    '',
    urunSatirlari,
    '',
    `*Toplam: ${order.toplam_tutar} TL*`,
    order.teslimat_adresi ? `Adres: ${order.teslimat_adresi}` : null,
    order.notlar ? `Not: ${order.notlar}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: mesaj, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('Telegram bildirimi gönderilemedi:', err);
  }
}

// Müşteri numarasına göre konuşma geçmişini bellekte tutuyoruz
const conversations = new Map();

function getHistory(jid) {
  if (!conversations.has(jid)) conversations.set(jid, []);
  return conversations.get(jid);
}

function pushHistory(jid, role, content) {
  const hist = getHistory(jid);
  hist.push({ role, content });
  while (hist.length > HISTORY_LIMIT) hist.shift();
}

// Claude'un sipariş kaydetmek için çağıracağı araç (tool)
const tools = [
  {
    name: 'siparis_kaydet',
    description:
      'Müşteri siparişini onayladığında (ürünler, adet, varyant, teslimat adresi ve toplam tutar netleştiğinde) bu aracı çağırarak siparişi kaydet.',
    input_schema: {
      type: 'object',
      properties: {
        musteri_adi: { type: 'string', description: 'Müşterinin adı (verdiyse)' },
        urunler: {
          type: 'array',
          description: 'Sipariş edilen ürünlerin listesi',
          items: {
            type: 'object',
            properties: {
              isim: { type: 'string' },
              adet: { type: 'number' },
              varyant: { type: 'string', description: 'Beden/renk vb. varsa' },
              birim_fiyat: { type: 'number' },
            },
            required: ['isim', 'adet', 'birim_fiyat'],
          },
        },
        toplam_tutar: { type: 'number' },
        teslimat_adresi: { type: 'string' },
        notlar: { type: 'string' },
      },
      required: ['urunler', 'toplam_tutar'],
    },
  },
];

function systemPrompt() {
  const products = loadProducts();
  const katalog = products
    .map((p) => {
      const varyant = p.varyantlar?.length ? ` (Seçenekler: ${p.varyantlar.join(', ')})` : '';
      return `- ${p.isim}: ${p.fiyat} ${p.para_birimi} — ${p.aciklama}${varyant}${p.stok ? '' : ' [STOKTA YOK]'}`;
    })
    .join('\n');

  return `Sen ${BUSINESS_NAME} isimli işletmenin WhatsApp üzerinden çalışan satış asistanısın. Türkçe, sıcak ve samimi ama profesyonel bir dille konuş. Kısa ve net mesajlar yaz, WhatsApp'a uygun olsun (uzun paragraflar yazma).

ÜRÜN KATALOĞU:
${katalog}

GÖREVİN:
1. Müşteriyle doğal bir şekilde sohbet et, ne aradığını anla.
2. Sorularını kataloğa göre yanıtla. Katalogda olmayan bir şey istenirse nazikçe "o an elimizde yok" de, uydurma ürün/fiyat söyleme.
3. Müşteri hangi ürünü, kaç adet, hangi varyantta (beden/renk) istediğine karar verdiğinde bunu netleştir.
4. Teslimat adresini sor.
5. Sipariş özetini (ürünler, toplam tutar, adres) müşteriye tekrar okuyup onay al.
6. Müşteri onayladığında siparis_kaydet aracını çağırarak siparişi sisteme kaydet, sonra müşteriye teşekkür edip sipariş numarası yerine "siparişiniz alındı" onayı ver.
7. Fiyatları kendin uydurma, sadece katalogdaki fiyatları kullan ve toplamı doğru hesapla.`;
}

async function askClaude(jid, userText) {
  pushHistory(jid, 'user', userText);

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    system: systemPrompt(),
    tools,
    messages: getHistory(jid),
  });

  // Claude bir araç çağırmak isterse (sipariş kaydetme), işleyip sonucu tekrar gönderiyoruz
  while (response.stop_reason === 'tool_use') {
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    let toolResult = 'Tamamlandı.';

    if (toolUse.name === 'siparis_kaydet') {
      const kayit = saveOrder({ telefon: jid.split('@')[0], ...toolUse.input });
      await notifyTelegram(kayit);
      toolResult = 'Sipariş başarıyla kaydedildi.';
    }

    pushHistory(jid, 'assistant', response.content);
    pushHistory(jid, 'user', [
      { type: 'tool_result', tool_use_id: toolUse.id, content: toolResult },
    ]);

    response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: systemPrompt(),
      tools,
      messages: getHistory(jid),
    });
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  const replyText = textBlock ? textBlock.text : 'Üzgünüm, bir şey söyleyemedim.';
  pushHistory(jid, 'assistant', response.content);
  return replyText;
}

// ---------- WhatsApp bağlantısı (Baileys) ----------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Telefonundan WhatsApp > Bağlı Cihazlar > Cihaz Bağla ile bu kodu tara:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Bağlantı kapandı.', shouldReconnect ? 'Yeniden bağlanılıyor...' : 'Çıkış yapıldı.');
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ WhatsApp bağlantısı kuruldu, bot hazır.');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (jid.endsWith('@g.us')) continue; // grup mesajlarını yoksay, sadece bireysel sohbet

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      if (!text) continue;

      console.log(`📩 ${jid}: ${text}`);

      try {
        await sock.sendPresenceUpdate('composing', jid);
        const reply = await askClaude(jid, text);
        await sock.sendMessage(jid, { text: reply });
        console.log(`🤖 -> ${jid}: ${reply}`);
      } catch (err) {
        console.error('Hata:', err);
        await sock.sendMessage(jid, {
          text: 'Üzgünüm, şu an bir sorun yaşıyorum. Birazdan tekrar yazar mısınız?',
        });
      }
    }
  });
}

startBot();
