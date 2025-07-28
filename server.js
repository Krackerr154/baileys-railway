import {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState
} from '@whiskeysockets/baileys';
import makeWASocket from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import express from 'express';

const logger = pino({ level: 'silent' });
const app = express();
const PORT = process.env.PORT || 3000;

let sock;
let qrCode;
let connectionStatus = 'Connecting...';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys version ${version}, isLatest: ${isLatest}`);

    sock = makeWASocket.default({
        version,
        logger,
        printQRInTerminal: false, // We'll handle QR printing manually
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        generateHighQualityLinkPreview: true,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        qrCode = qr;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) &&
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = `Connection closed due to ${lastDisconnect.error}, reconnecting: ${shouldReconnect}`;
            console.log(connectionStatus);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000); // Reconnect after 5 seconds
            } else {
                 // Clean auth files on logout
                console.log("Logged out, cleaning up auth files and restarting.");
                const fs = await import('fs/promises');
                try {
                    await fs.rm('baileys_auth_info', { recursive: true, force: true });
                } catch (e) {
                    console.error("Failed to clean auth directory:", e);
                }
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'WhatsApp connected successfully!';
            qrCode = undefined; // Clear QR code once connected
            console.log(connectionStatus);
        } else {
            connectionStatus = connection || 'Connecting...';
        }

        // Print QR code if available
        if (qr) {
            console.log('QR Code received, scan with your phone:');
            qrcode.generate(qr, { small: true });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') {
            return;
        }

        const sender = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        console.log(`Received message from ${sender}: "${messageText}"`);

        if (messageText.toLowerCase() === 'ping') {
            await sock.sendMessage(sender, { text: 'Pong! pong! 🏓' });
            console.log(`Sent "Pong!" to ${sender}`);
        }
    });

    return sock;
}

// Express server to keep the process alive
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
        status: 'OK',
        message: 'WhatsApp Bot is running.',
        connection: connectionStatus,
        qr: qrCode ? 'QR code is available at /qr' : 'No QR code available.'
    });
});

app.get('/qr', (req, res) => {
    if (qrCode) {
        res.setHeader('Content-Type', 'text/plain');
        qrcode.generate(qrCode, { small: true }, (qr) => {
            res.send(qr);
        });
    } else {
        res.status(404).send('QR code not available. The bot might be already connected.');
    }
});


// Start the connection and the server
connectToWhatsApp().catch(err => console.error("Initial WhatsApp connection failed: ", err));

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}. Access http://localhost:${PORT} for status.`);
});