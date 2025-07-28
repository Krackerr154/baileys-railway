import makeWASocket, { useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import express from 'express'

const { state, saveState } = useSingleFileAuthState('./auth_info.json')

const startSock = async () => {
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true
  })

  sock.ev.on('creds.update', saveState)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      console.log('QR code received, displaying...')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
      if (shouldReconnect) {
        startSock()
      }
    } else if (connection === 'open') {
      console.log('connected to WA')
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
