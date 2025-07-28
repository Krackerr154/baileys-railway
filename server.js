import baileys from '@whiskeysockets/baileys';
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = baileys;
import qrcode from 'qrcode-terminal';
import express from 'express';
import axios from 'axios';

const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
const { version } = await fetchLatestBaileysVersion();

const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true
});

sock.ev.on('creds.update', saveCreds);
sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') console.log('✅ Baileys aktif!');
});

// (Lanjutkan logic kirim pesan ke n8n & endpoint /send)


// ✅ Kirim pesan masuk ke n8n (opsional)
sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;

    const nomor = m.key.remoteJid;
    const pesan = m.message.conversation;

    try {
        await axios.post("https://pp-assistant154.azurewebsites.net/webhook/whatsapp", { nomor, pesan });
    } catch (e) {
        console.log("Gagal kirim ke n8n:", e.message);
    }
});

// ✅ Express server untuk menerima perintah kirim pesan
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("✅ Baileys Bot Running di Railway"));

app.post("/send", async (req, res) => {
    const { nomor, pesan } = req.body;
    try {
        await sock.sendMessage(nomor, { text: pesan });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ✅ Anti-sleep ping endpoint
app.get("/ping", (req, res) => res.send("pong"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server jalan di port ${PORT}`));
