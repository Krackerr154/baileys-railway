import baileys from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fs from 'fs';
import axios from 'axios';

const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;

// ✅ Auto-reset auth jika error koneksi
if (fs.existsSync('./auth_info')) {
    fs.rmSync('./auth_info', { recursive: true, force: true });
    console.log("🗑️ Auth lama dihapus, siap scan ulang QR.");
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('✅ WA Connected');
        } else if (connection === 'close') {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed. Reconnecting...', lastDisconnect?.error);
            if (shouldReconnect) {
                startBot();
            } else {
                console.log("🔴 Logged out, hapus auth_info dan scan ulang QR.");
                fs.rmSync('./auth_info', { recursive: true, force: true });
                startBot();
            }
        }
    });

    // ✅ Contoh kirim otomatis ke n8n jika ada pesan masuk
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        const chatId = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

        console.log("📩 Pesan diterima:", chatId, text);

        // Kirim ke n8n (ubah URL sesuai n8n kamu)
        try {
            await axios.post("https://YOUR-N8N-URL/webhook/whatsapp", {
                chatId,
                text
            });
        } catch (err) {
            console.error("❌ Gagal kirim ke n8n:", err.message);
        }
    });

    // ✅ Endpoint manual kirim pesan
    const app = express();
    app.use(express.json());
    app.post('/send', async (req, res) => {
        const { chatId, text } = req.body;
        await sock.sendMessage(chatId, { text });
        res.json({ status: 'ok', sent: text });
    });

    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => console.log(`✅ Server jalan di port ${PORT}`));
}

startBot();
