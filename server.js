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
import * as fs from 'fs/promises'; // Import fs/promises at the top

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
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        generateHighQualityLinkPreview: true,
    });

    // Make the event listener callback async to use await
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        qrCode = qr;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) &&
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = `Connection closed due to ${lastDisconnect.error}, reconnecting: ${shouldReconnect}`;
            console.log(connectionStatus);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                console.log("Logged out, cleaning up auth files and restarting.");
                try {
                    await fs.rm('baileys_auth_info', { recursive: true, force: true });
                } catch (e) {
                    console.error("Failed to clean auth directory:", e);
                }
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            connectionStatus = 'WhatsApp connected successfully!';
            qrCode = undefined;
            console.log(connectionStatus);
        } else {
            connectionStatus = connection || 'Connecting...';
        }

        if (qr) {
            console.log('QR Code received, scan with your phone:');
            qrcode.generate(qr, { small: true });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        // ...
		if (!msg.message || msg.key.remoteJid === 'status@broadcast') {
			return;
		}	
// ...

        const sender = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        console.log(`Received message from ${sender}: "${messageText}"`);

        if (messageText.toLowerCase() === 'ping') {
            await sock.sendMessage(sender, { text: 'Pong! 🏓' });
            console.log(`Sent "Pong!" to ${sender}`);
        }
    });

    return sock;
}

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

connectToWhatsApp().catch(err => console.error("Initial WhatsApp connection failed: ", err));

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}. Access http://localhost:${PORT} for status.`);
});