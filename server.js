const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const fs = require('fs')
const express = require('express')

const { state, saveState } = useSingleFileAuthState('./auth_info.json')

const startSock = async () => {
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '22.04.4'],
  })

  sock.ev.on('creds.update', saveState)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('📱 Scan QR code:')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('❌ Disconnected. Reconnecting...', lastDisconnect?.error)
      if (shouldReconnect) {
        startSock()
      }
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      const msg = messages[0]
      if (!msg.key.fromMe && msg.message?.conversation === 'ping') {
        await sock.sendMessage(msg.key.remoteJid, { text: 'pong' })
      }
    }
  })
}

startSock()

const app = express()
const PORT = process.env.PORT || 8080

app.get('/', (req, res) => {
  res.send('✅ Server jalan di port ' + PORT)
})

app.listen(PORT, () => {
  console.log(`✅ Server jalan di port ${PORT}`)
})
