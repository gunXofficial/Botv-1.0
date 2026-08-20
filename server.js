const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, makeInMemoryStore, DisconnectReason } = require('@whiskeysockets/baileys');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== KONFIGURASI ==========
const ADMIN_NUMBER = '6282189658650'; // GANTI ke nomor bot kamu
const TIMEZONE = 'Asia/Jayapura'; // Maluku Utara
// =================================

app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

let sock = null;
let connectionState = { status: 'disconnected', qr: null, pairingCode: null };
let logs = [];
let autoReply = { aktif: false, pesan: '' };
let rvoMode = 'on'; // "on" = kirim langsung, "off" = kirim ke diri sendiri

function tambahLog(teks) {
  const waktu = new Date().toLocaleString('id-ID', { timeZone: TIMEZONE });
  logs.push(`[${waktu}] ${teks}`);
  if (logs.length > 50) logs.shift();
}

async function inisialisasiBot() {
  const { state, saveCreds } = await useMultiFileAuthState('sesi-bot');
  const store = makeInMemoryStore();

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false
  });

  store.bind(sock.ev);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, pairingCode } = update;
    
    if (qr) connectionState.qr = qr;
    if (pairingCode) connectionState.pairingCode = pairingCode;

    if (connection === 'connecting') {
      connectionState.status = 'connecting';
      tambahLog('State update: connecting');
    }
    if (connection === 'open') {
      connectionState.status = 'connected';
      connectionState.qr = null;
      tambahLog('✅ Terhubung ke WhatsApp');
      tambahLog(`✅ Siap menerima pesan di +${sock.user.id.split('@')[0]}`);
    }
    if (connection === 'close') {
      connectionState.status = 'disconnected';
      tambahLog('❌ Koneksi terputus');
    }
  });

  // PESAN MASUK
  sock.ev.on('messages.upsert', async m => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const pengirim = msg.key.remoteJid;
    const teks = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const dariAdmin = pengirim?.startsWith(ADMIN_NUMBER) || pengirim === `${ADMIN_NUMBER}@c.us`;

    // AUTO-REPLY
    if (autoReply.aktif && autoReply.pesan && !teks.startsWith('.')) {
      await sock.sendMessage(pengirim, { text: autoReply.pesan });
      return;
    }

    // HANYA PROSES PERINTAH DARI ADMIN
    if (!teks.startsWith('.')) return;

    const perintah = teks.toLowerCase().trim();

    if (perintah === '.menu' && dariAdmin) {
      await sock.sendMessage(pengirim, { text: `
╭═══════════════════
║   🤖 MENU BOT
║
║ .rvo on/off 
║ .waktu 
║ .blsotomatis 
║ .matikanotomatis
║ .infoaku 
║ .menu 
║ .menu 
╰═══════════════════
      `.trim() });
    }

    if (perintah === '.rvo on' && dariAdmin) {
      rvoMode = 'on';
      await sock.sendMessage(pengirim, { text: '✅ RVO  LANGSUNG di Obrolan' });
    }
    if (perintah === '.rvo off' && dariAdmin) {
      rvoMode = 'off';
      await sock.sendMessage(pengirim, { text: '✅ RVO  KIRIM KE SAYA SAJA' });
    }

    if (perintah === '.waktu') {
      const sekarang = new Date().toLocaleString('id-ID', { timeZone: TIMEZONE });
      await sock.sendMessage(pengirim, { text: `🕐 Waktu Maluku Utara:\n${sekarang}` });
    }

    if (perintah.startsWith('.blsotomatis ') && dariAdmin) {
      autoReply.aktif = true;
      autoReply.pesan = teks.slice(13);
      await sock.sendMessage(pengirim, { text: `✅ Balas Otomatis AKTIF:\n"${autoReply.pesan}"` });
    }
    if (perintah === '.matikanotomatis' && dariAdmin) {
      autoReply.aktif = false;
      await sock.sendMessage(pengirim, { text: '✅ Balas Otomatis DIMATIKAN' });
    }

    if (perintah === '.infoaku') {
      await sock.sendMessage(pengirim, { text: `📱 Nomor Bot: +${ADMIN_NUMBER}` });
    }

    // === FITUR RVO FOTO & VIDEO ===
    const isViewOnceImage = msg.message?.imageMessage?.viewOnce;
    const isViewOnceVideo = msg.message?.videoMessage?.viewOnce;

    if ((isViewOnceImage || isViewOnceVideo) && dariAdmin) {
      const media = isViewOnceImage ? 'image' : 'video';
      const mediaMsg = isViewOnceImage ? msg.message.imageMessage : msg.message.videoMessage;
      
      let tujuan;
      if (rvoMode === 'on') {
        tujuan = pengirim; // Balas di obrolan yang sama
      } else {
        tujuan = `${ADMIN_NUMBER}@c.us`; // Kirim ke diri sendiri
      }

      const buffer = await sock.downloadMediaMessage(msg);
      await sock.sendMessage(tujuan, {
        [media]: buffer,
        caption: '📸 Dari Sekali Lihat'
      });
      tambahLog(`📤 RVO dikirim ke ${rvoMode === 'on' ? 'obrolan' : 'diri sendiri'}`);
    }
  });
}

// ========== ROUTES WEB ==========
app.get('/', (req, res) => {
  res.render('web', { connectionState, logs, ADMIN_NUMBER });
});

app.post('/pairing', async (req, res) => {
  const nomor = req.body.nomor?.replace(/\D/g, '');
  if (!sock || connectionState.status !== 'connecting') {
    return res.redirect('/');
  }
  try {
    await sock.requestPairingCode(nomor);
    tambahLog(`📲 Mengirim kode pairing ke +${nomor}`);
  } catch (e) {
    tambahLog(`❌ Gagal: ${e.message}`);
  }
  res.redirect('/');
});

app.post('/restart', async (req, res) => {
  sock?.end();
  connectionState = { status: 'connecting', qr: null, pairingCode: null };
  tambahLog('🔄 Menghubungkan ulang...');
  await inisialisasiBot();
  res.redirect('/');
});

app.post('/hapus-sesi', async (req, res) => {
  sock?.end();
  connectionState = { status: 'disconnected' };
  const fs = require('fs');
  if (fs.existsSync('./sesi-bot')) fs.rmSync('./sesi-bot', { recursive: true });
  tambahLog('🗑️ Sesi dihapus');
  res.redirect('/');
});

app.post('/stop', (req, res) => {
  sock?.end();
  connectionState.status = 'disconnected';
  tambahLog('⏹️ Bot dihentikan');
  res.redirect('/');
});

// ========== JALANKAN ==========
app.listen(PORT, () => {
  console.log(`🌐 Web dibuka di port ${PORT}`);
  inisialisasiBot();
});
