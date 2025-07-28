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
import * as fs from 'fs/promises';

// --- 🎯 CONFIGURATION ---
const TARGET_PHONE_NUMBER = '6282140063265@s.whatsapp.net'; // 👈 PASTE TARGET PHONE NUMBER ID HERE
const N8N_AI_AGENT_WEBHOOK_URL = 'https://pp-assistant154.azurewebsites.net/webhook-test/ce778736-9b63-472f-a1e2-be679b82289e';  // 👈 PASTE N8N WEBHOOK FOR THE AI AGENT
const KEYWORD = 'HERP';
// -------------------------

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
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') {
            return;
        }

        const sender = msg.key.remoteJid;
        
        // Only process messages from the target phone number
        if (sender !== TARGET_PHONE_NUMBER) {
            return;
        }

        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        // Check if the message contains the keyword (case-insensitive)
        if (messageText.toUpperCase().includes(KEYWORD.toUpperCase())) {
            console.log(`Keyword "${KEYWORD}" detected from ${sender}.`);
            
            try {
                // 1. Send the initial confirmation message
                await sock.sendMessage(sender, { text: `Connecting you to ${KEYWORD}...` });
                console.log(`Sent "Connecting" message to ${sender}.`);

                // 2. Prepare and forward the data to n8n
                const payload = {
                    sender_id: sender,
                    sender_name: msg.pushName,
                    message: messageText,
                    timestamp: new Date().toISOString()
                };

                console.log('Forwarding message to n8n AI agent...');
                const response = await fetch(N8N_AI_AGENT_WEBHOOK_URL, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' }
                });

                if (!response.ok) {
                    throw new Error(`n8n webhook returned status ${response.status}`);
                }
                
                console.log('Message successfully forwarded to n8n.');

            } catch (error) {
                console.error('Error during AI agent processing:', error);
                await sock.sendMessage(sender, { text: `Sorry, could not connect to ${KEYWORD} at the moment. Please try again later. ❌` });
            }
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
        mode: 'AI Agent Gatekeeper',
        target_number: TARGET_PHONE_NUMBER,
        keyword: KEYWORD
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