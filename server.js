import baileys from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fs from 'fs';
import axios from 'axios';
import { webcrypto } from "node:crypto";

const { makeWASocket, useSingleFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal'); // Tambahkan ini

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

async function startSock() {
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Jangan pakai ini lagi, sudah deprecated
        browser: ['Ubuntu', 'Chrome', '22.04.4'],
    });

    // Tampilkan QR di terminal secara manual
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrcode.generate(qr, { small: true }); // Tampilkan QR ke terminal
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('❌ Disconnected, reconnecting...', lastDisconnect?.error);
            if (shouldReconnect) {
                startSock();
            }
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp');
        }
    });

    sock.ev.on('creds.update', saveState);
}

startSock();


// ✅ Fix "crypto is not defined"
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;

// ✅ Hapus auth lama hanya jika pertama kali run (optional)
if (fs.existsSync('./auth_info')) {
    fs.rmSync('./auth_info', { recursive: true, force: true });
    console.log("🗑️ Auth lama dihapus, siap scan ulang QR.");
}

let sock; // ✅ Biar tidak double instance

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
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
                setTimeout(() => startBot(), 5000);
            } else {
                console.log("🔴 Logged out, hapus auth_info dan scan ulang QR.");
                fs.rmSync('./auth_info', { recursive: true, force: true });
                setTimeout(() => startBot(), 5000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const chatId = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

        console.log("📩 Pesan diterima:", chatId, text);

        // Kirim ke n8n
        try {
            await axios.post("https://YOUR-N8N-URL/webhook/whatsapp", {
                chatId,
                text
            });
        } catch (err) {
            console.error("❌ Gagal kirim ke n8n:", err.message);
        }
    });
}

// ✅ Jalankan Express hanya sekali (tidak diulang saat reconnect)
const app = express();
app.use(express.json());

app.post('/send', async (req, res) => {
    const { chatId, text } = req.body;
    if (!sock) return res.status(500).json({ error: "Bot belum siap" });

    await sock.sendMessage(chatId, { text });
    res.json({ status: 'ok', sent: text });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server jalan di port ${PORT}`));

// ✅ Mulai bot pertama kali
startBot();
