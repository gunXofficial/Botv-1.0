// ==============================================
//              BOT WA BISNIS 
// ==============================================

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const express = require('express');
const http = require('http');

// === PANEL WEB BOT ===
const app = express();
const PORT = 3000;

// Data status bot
let botStatus = {
    status: 'Online',
    nomor: '6282189658650',
    sejak: new Date().toLocaleString('id-ID')
};

// Halaman utama
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Panel Bot WhatsApp</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin:0; padding:0; box-sizing:border-box; font-family: system-ui; }
        body { background: #0f172a; color: white; padding: 20px; max-width: 500px; margin: 0 auto; }
        .card { background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 16px; }
        .status { display: flex; align-items: center; gap: 10px; font-size: 24px; font-weight: bold; }
        .dot { width: 14px; height: 14px; background: #22c55e; border-radius: 50%; }
        .label { color: #94a3b8; font-size: 14px; margin-top: 16px; }
        .value { font-size: 18px; margin-top: 4px; }
        .btn { padding: 14px 24px; border-radius: 10px; border: none; font-weight: bold; cursor: pointer; margin-top: 10px; width: 100%; }
        .stop { background: #f59e0b; color: black; }
        .restart { background: #3b82f6; color: white; }
    </style>
</head>
<body>
    <h1 style="text-align:center; margin-bottom:30px;">🤖 Panel Bot WhatsApp</h1>
    
    <div class="card">
        <div class="status">
            <span class="dot"></span>
            ${botStatus.status}
        </div>
        <div class="label">Nomor Bot</div>
        <div class="value">${botStatus.nomor}</div>
        <div class="label">Berjalan Sejak</div>
        <div class="value">${botStatus.sejak}</div>
    </div>

    <div class="card">
        <button class="btn restart" onclick="location.reload()">🔄 Segarkan Status</button>
    </div>
</body>
</html>
    `);
});

// Jalankan server web
const server = http.createServer(app);
server.listen(PORT, () => {
    console.log(`🌐 Panel Web berjalan di http://localhost:${PORT}`);
});


// --- KONFIGURASI ---
let NOMOR_OWNER = ''; // ganti nomor kamu: 628xxxxxxx
let LID_OWNER = '';
let jadwalList = [];
let autoReplyStatus = false;
let autoReplyPesan = '';
let rvoMode = 'off'; // default: kirim ke diri sendiri
const SESSION_FOLDER = './session';
const MEDIA_FOLDER = './media_rvo';
if (!fs.existsSync(MEDIA_FOLDER)) fs.mkdirSync(MEDIA_FOLDER);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const tanya = (pertanyaan) => new Promise(jawab => rl.question(pertanyaan, jawab));

async function mulaiBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

  // --- FUNGSI UNDUH MEDIA SEKALI LIHAT ---

async function prosesViewOnceMessage(msg, sock) {
    try {
        // Cek apakah ini pesan sekali lihat
        const tipePesan = msg.message?.viewOnceMessage ? 'viewOnce' : 
                         msg.message?.viewOnceMessageV2 ? 'viewOnceV2' : null;
        
        if (!tipePesan) return null;

        // Ambil isi pesan asli
        let isiMedia;
        if (tipePesan === 'viewOnce') {
            isiMedia = msg.message.viewOnceMessage.message;
        } else if (tipePesan === 'viewOnceV2') {
            isiMedia = msg.message.viewOnceMessageV2.message;
        }

        if (!isiMedia) return null;

        // Unduh media
        const buffer = await downloadMediaMessage(
            { key: msg.key, message: isiMedia },
            'buffer',
            {},
            { logger: sock.logger }
        );

        // Tentukan tipe media
        let tipe = null;
        if (isiMedia.imageMessage) tipe = 'image';
        else if (isiMedia.videoMessage) tipe = 'video';

        return { buffer, tipe, isiMedia };
    } catch (err) {
        console.error('❌ Gagal proses view-once:', err);
        return null;
    }
}

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        defaultQueryTimeoutMs: 60000,
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 20000,
        retryRequestDelayMs: 5000,
        maxRetries: 5
    });

    // --- PAIRING ---
    if (!state.creds.registered) {
        console.log('\n🔑 === PROSES PAIRING ===');
        const inputNomor = await tanya('Masukkan nomor WA kamu (format: 628xxxxxxx, tanpa +): ');
        NOMOR_OWNER = inputNomor.replace(/[^0-9]/g, '');
        try {
            const kodePairing = await sock.requestPairingCode(NOMOR_OWNER);
            console.log(`\n✅ KODE PAIRING KAMU: ${kodePairing}`);
            console.log('👉 Buka WA  → Pengaturan → Perangkat Tertaut → Tautkan Perangkat → Tautkan dengan nomor');
            console.log('👉 Masukkan kode di atas...\n');
        } catch (err) {
            console.error('\n❌ Gagal pairing:', err.message);
            process.exit(1);
        }
    } else {
        NOMOR_OWNER = state.creds.me.id.split(':')[0];
        console.log(`🔐 Sesi ditemukan. Nomor bot: ${NOMOR_OWNER}`);
    }

    // --- KONEKSI ---
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastError } = update;
        if (connection === 'open') {
            console.log('\n✅ ✅ BOT TERHUBUNG! RVO AKTIF!');
            rl.close();
            const jidAwal = LID_OWNER || `${NOMOR_OWNER}@s.whatsapp.net`;
            await kirimPesan(sock, jidAwal, '🤖 AKTIF BOSS   ✅ ');
        }
        if (connection === 'close') {
            rl.close();
            const keluarLog = lastError instanceof Boom && lastError.output?.statusCode === DisconnectReason.loggedOut;
            if (keluarLog) {
                console.log('⚠️ Sesi keluar — hapus folder "session" & jalankan ulang');
            } else {
                console.log(`🔄 Menyambung ulang...`);
                setTimeout(() => mulaiBot(), 5000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- MENANGANI PESAN & RVO ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const pengirimJid = msg.key.remoteJid;
        const isGroup = pengirimJid.endsWith('@g.us');
        const dariMe = msg.key.fromMe;

                      // --- LOGIKA BALAS OTOMATIS ---
        if (!dariMe && !isGroup && autoReplyStatus && autoReplyPesan.trim() !== '') {
    console.log(`🤖 Balas otomatis ke ${pengirimJid}: ${autoReplyPesan}`);
    await kirimPesan(sock, pengirimJid, autoReplyPesan);
    return; // 🔴 MUTLAK KELUAR — TIDAK ADA PROSES LANJUT
}

        // 📋 LOG
        console.log('\n📥 PESAN DITERIMA:');
        console.log('fromMe:', dariMe);
        console.log('remoteJid:', pengirimJid);
        console.log('isGroup:', isGroup);

        // Simpan LID owner
        if (dariMe && pengirimJid.endsWith('@lid') && !LID_OWNER) {
            LID_OWNER = pengirimJid;
            console.log(`✅ LID OWNER disimpan: ${LID_OWNER}`);
        }

        // 🔒 HANYA PROSES PERINTAH DARI KAMU SENDIRI
    if (!dariMe) return;

        // ✅ BACA PERINTAH
        let teks = '';
        if (msg.message.conversation) teks = msg.message.conversation;
        else if (msg.message.extendedTextMessage?.text) teks = msg.message.extendedTextMessage.text;
        if (!teks || !teks.startsWith('.')) return;

        console.log(`✅ PERINTAH DIKENALI: ${teks}`);
        const jidBalas = LID_OWNER || `${NOMOR_OWNER}@s.whatsapp.net`;

        try {
                // === FUNGSI BANTUAN RVO ===
async function prosesDanKirimRVO(sock, msg, quotedMsg, mode, jidBalas) {
    try {
        let isiMedia = null;
        let tipeMedia = null;
        let isViewOnce = false;

        if (quotedMsg.imageMessage) {
            isiMedia = quotedMsg.imageMessage;
            tipeMedia = 'image';
            isViewOnce = quotedMsg.imageMessage.viewOnce === true;
        } else if (quotedMsg.videoMessage) {
            isiMedia = quotedMsg.videoMessage;
            tipeMedia = 'video';
            isViewOnce = quotedMsg.videoMessage.viewOnce === true;
        } else {
            await kirimPesan(sock, jidBalas, `❌ Yang kamu balas bukan foto/video!`);
            return;
        }

        if (!isViewOnce) {
            await kirimPesan(sock, jidBalas, `❌ Yang kamu balas BUKAN pesan sekali lihat!\n\nPastikan ada ikon 👁️ SEKALI LIHAT.`);
            return;
        }

        await kirimPesan(sock, jidBalas, `⏳ Sedang memproses...`);
        
        const pesanDibuat = {
            key: {
                remoteJid: msg.key.remoteJid,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                fromMe: msg.message.extendedTextMessage.contextInfo.participant === msg.key.remoteJid?.split('@')[0]
            },
            message: {
                [tipeMedia === 'image' ? 'imageMessage' : 'videoMessage']: isiMedia
            }
        };

        const buffer = await downloadMediaMessage(
            pesanDibuat,
            'buffer',
            {},
            { logger: sock.logger }
        );

        const namaPengirim = msg.key.remoteJid.split('@')[0];
        // ✅ TENTUKAN TUJUAN PENGIRIMAN — PASTI BENAR!
       let tujuanKirim;

        if (mode === 'on') {
        // 📤 MODE ON → KIRIM KE CHAT ASAL
           tujuanKirim = msg.key.remoteJid;
       console.log('📤 MODE ON : Kirim ke obrolan', tujuanKirim);
         } else {
         // 🔒 MODE OFF → KIRIM KE DIRI SENDIRI
            tujuanKirim = LID_OWNER || (NOMOR_OWNER + '@s.whatsapp.net');
         console.log('🔒 MODE OFF : Kirim ke diri sendiri', tujuanKirim);
            }
        const pesanTambahan = mode === 'on'
            ? '📤 Dikirim ke obrolan'
            : '🔒 Dikirim ke diri sendiri';

        if (tipeMedia === 'image') {
            await sock.sendMessage(tujuanKirim, {
                image: buffer,
                caption: `📸 FOTO SEKALI LIHAT\n✅ Berhasil diubah jadi foto biasa!\n\n📂 Dari: ${namaPengirim}\n${pesanTambahan}`,
                viewOnce: false
            });
        } else if (tipeMedia === 'video') {
            await sock.sendMessage(tujuanKirim, {
                video: buffer,
                caption: `🎬 VIDEO SEKALI LIHAT\n✅ Berhasil diubah jadi video biasa!\n\n📂 Dari: ${namaPengirim}\n${pesanTambahan}`,
                mimetype: 'video/mp4',
                viewOnce: false
            });
        }

        console.log(`✅ RVO BERHASIL! Mode: ${mode} | Tujuan: ${tujuanKirim}`);

    } catch (err) {
        console.error('❌ Error RVO:', err);
        let pesanError = '❌ Gagal memproses!';
        if (err.message?.includes('bad decrypt')) {
            pesanError = '❌ Gagal dekripsi!\n⚠️ Pastikan media belum dibuka. Minta kirim ulang & coba lagi.';
        }
        await kirimPesan(sock, jidBalas, pesanError);
    }
}
   
                       // === FITUR RVO: .rvo on / .rvo off — LANGSUNG PROSES! ===
if (teks === '.rvo on') {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quotedMsg) {
        rvoMode = 'on';
        await kirimPesan(sock, jidBalas, `✅ RVO ON\n\n📤 Foto/video sekali lihat di kirim langsung ke obrolan!\n\n💡 Cara pakai: BALAS foto/video sekali lihat, lalu ketik .rvo on`);
        return;
    }

    rvoMode = 'on';
    await prosesDanKirimRVO(sock, msg, quotedMsg, 'on', jidBalas);
}
else if (teks === '.rvo off') {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quotedMsg) {
        rvoMode = 'off';
        await kirimPesan(sock, jidBalas, `✅ RVO OFF\n\n🔒 Foto/video sekali lihat di kirim ke diri sendiri!\n\n💡 Cara pakai: BALAS foto/video sekali lihat, lalu ketik .rvo off`);
        return;
    }

    rvoMode = 'off';
    await prosesDanKirimRVO(sock, msg, quotedMsg, 'off', jidBalas);
}
            // === FITUR BIKIN STIKER ===
            else if (teks === '.s' || teks === '.stiker') {
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                
                if (!quotedMsg) {
                    await kirimPesan(sock, jidBalas, `⚠️ SUKSES`);
                    return;
                }

                let isiMedia = null;
                let tipeMedia = null;

                // Cek tipe media
                if (quotedMsg.imageMessage) {
                    isiMedia = quotedMsg.imageMessage;
                    tipeMedia = 'image';
                } else if (quotedMsg.videoMessage) {
                    isiMedia = quotedMsg.videoMessage;
                    tipeMedia = 'video';
                } else {
                    await kirimPesan(sock, jidBalas, `❌ Yang kamu balas bukan foto/gambar!`);
                    return;
                }

                try {
                    await kirimPesan(sock, jidBalas, `⏳`);
                    
                    // Buat objek pesan untuk download
                    const pesanDibuat = {
                        key: {
                            remoteJid: msg.key.remoteJid,
                            id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                            fromMe: msg.message.extendedTextMessage.contextInfo.participant === msg.key.remoteJid?.split('@')[0]
                        },
                        message: {
                            [tipeMedia === 'image' ? 'imageMessage' : 'videoMessage']: isiMedia
                        }
                    };

                    // Download media
                    const buffer = await downloadMediaMessage(
                        pesanDibuat,
                        'buffer',
                        {},
                        { logger: sock.logger }
                    );

                    const namaPengirim = msg.key.remoteJid.split('@')[0];
                  
                  // ✅ KONVERSI KE WEBP — WAJIB UNTUK STIKER!
                    const webpBuffer = await sharp(buffer)
                      .resize(512, 512, { 
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 } // transparan
                      })
                      .webp({ quality: 90 })
                      .toBuffer();

                                        // ✅ KIRIM SEBAGAI STIKER — FORMAT LENGKAP & BENAR!
                    await sock.sendMessage(msg.key.remoteJid, {
                        sticker: webpBuffer,
                        mimetype: 'image/webp',  // ✅ WA WAJIB pakai webp!
                        packname: 'Bot WA Pribadi',
                        author: namaPengirim,
                        timestamp: Date.now(),
                        categories: ['🤖'],  // ✅ Emoji stiker
                        stickerMetadata: {
                            isAnimated: false,
                            textColor: '#000000',
                            background: '#FFFFFF'
                        }
                    });


                    console.log(`✅ STIKER BERHASIL! Dari: ${namaPengirim}`);
                                        // Hapus pesan "Sedang membuat stiker..."
                    setTimeout(async () => {
                        await sock.sendMessage(jidBalas, { 
                            delete: { 
                                remoteJid: jidBalas, 
                                id: msg.key.id 
                            } 
                        });
                    }, 1500);

          
                } catch (err) {
                    console.error('❌ Error Stiker:', err);
                    await kirimPesan(sock, jidBalas, `❌ Gagal \nError: ${err.message}`);
                }
            }

                                    
else  if (teks === '.menu' || teks === '.help') {
                const daftar = `
╔════════════════════════════════════╗
║          🤖 BOT WA PRIBADI          ║
╠════════════════════════════════════╣
║  📋 DAFTAR PERINTAH YANG TERSEDIA  ║
╠════════════════════════════════════╣
║  
║═════════》🔧 FITUR UTAMA:
║  .rvo on
║  .rvo off
╠═════════》🛠️ lainnya:
║
║
║
║
║
║  
║  .iqc
║  .s/stiker
║  .balasotomatis 
║  .matikanotomatis    
║  .waktu 
║  .infoaku
║  .menu  
╠════════════════════════════════════╣
║  ✨  BOT PRIVAT GUN GANTENG   SINGLE BOSS ║
╚════════════════════════════════════╝
`;
                await kirimPesan(sock, jidBalas, daftar);
            }
                //==PERINTAH lainnya
  
  else if (teks === '.rvo') {
                const infoRVO = `
╔════════════════════════════════════╗
║          📸 RVO NI BOSS 🤪           ║
╠════════════════════════════════════╣
║ FOTO/VIDEO SEKALI LIHAT LU NDA BERGUNA  ║
║ DI GUN GANTENG PE WA,                   ║
║                                         ║
║   Ikan hiuu dalam doss gunn niehh bosss ║
╠════════════════════════════════════╣
  `;
                await kirimPesan(sock, jidBalas, infoRVO);
            }

else if (teks === '.waktu') {
    // Gunakan Etc/GMT-9 = UTC+9 → sama dengan WIT (Maluku Utara)
    const sekarang = new Date().toLocaleString('id-ID', { 
        timeZone: 'Etc/GMT-9',
        dateStyle: 'full',
        timeStyle: 'medium'
    });
    await kirimPesan(sock, jidBalas, `🕒 WAKTU MALUKU UTARA (WIT):
╔════════════════════════════════════╗
║  ${sekarang}  ║
╚════════════════════════════════════╝`);
}
            // --- FITUR BARU ---
            else if (teks === '.infoaku') {
                const infoAku = `
╔════════════════════════════════════╗
║          📱 INFO AKU                ║
╠════════════════════════════════════╣
║  📛 Nama    :  gunn mangda          ║
║  📞 Nomor   : ${NOMOR_OWNER}        ║
║  📍 Alamat  : Morotai  sambiki      ║
║                      HALLO GANTENG  ║
╚════════════════════════════════════╝
`;
                await kirimPesan(sock, jidBalas, infoAku);
            }

            
            if (teks.startsWith('.balasotomatis ')) {
    autoReplyStatus = true;
    autoReplyPesan = teks.slice(15).trim();
    await kirimPesan(sock, jidBalas, `✅ Balasan otomatis AKTIF:\n"${autoReplyPesan}"`);
}
else if (teks === '.matikanotomatis') {
    autoReplyStatus = false;
    autoReplyPesan = '';
    await kirimPesan(sock, jidBalas, `✅ Balasan otomatis DIMATIKAN.`);
}

        } catch (err) {
            console.error('❌ Error:', err);
        }
    });
}
 
//== JANGAN DI UBAH BOSS ☆

// --- FUNGSI KIRIM PESAN ---
async function kirimPesan(sock, jidAtauNomor, teks) {
    const jid = jidAtauNomor.includes('@') ? jidAtauNomor : `${jidAtauNomor}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: teks });
}

// --- JALANKAN BOT ---
mulaiBot().catch(err => {
    console.error('❌ Error fatal:', err);
    setTimeout(() => mulaiBot(), 5000);
})