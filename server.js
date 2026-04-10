// why do i do this to myself?

const http = require('http')
const express = require('express')
const mineflayer = require('mineflayer')
// const { mineflayerViewer } = require('prismarine-viewer')
// const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
// const io = new Server(server)

app.use(express.json())

let bot = null
let botStatus = 'disconnected'
let chatLog = []
let keys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
}

// ==========================================
// BOT CREATION
// ==========================================

function createBot(host, port, username) {
if (bot && typeof bot.quit === 'function') {
  bot.quit()
  bot = null
}   

    botStatus = 'connecting'
    chatLog = []

bot = mineflayer.createBot({
    host: host || 'localhost',
    port: port || 25565,
    username: username || 'hURoMCB-nilname',
    version: false,
    auth: 'offline',  // ADD THIS
    keepAlive: false,  // ADD THIS TOO
})


    bot.once('spawn', () => {
        botStatus = 'connected'
        try {
            const { mineflayerViewer } = require('prismarine-viewer')
            // mineflayerViewer(bot, { server, firstPerson: true })
            console.log('Viewer running!')
        } catch (e) {
            console.log('Viewer failed to load, continuing without it:', e.message)
        }
    })

    bot.on('error', (err) => {
        botStatus = 'error'
        console.error('Bot error:', err.message)
    })

    bot.on('end', () => {
        botStatus = 'disconnected'
        console.log('Bot disconnected')
        bot = null
    })

    bot.on('kicked', (reason) => {   
        botStatus = 'disconnected'
        console.log('Bot kicked:', reason)
        bot = null
    })
    bot.on('message', (jsonMsg) => {
        const msg = jsonMsg.toString()
        chatLog.push(msg)
        if (chatLog.length > 50) chatLog.shift()
    })
}

// ==========================================
// MOVEMENT LOOP
// ==========================================

setInterval(() => {
    if (!bot || botStatus !== 'connected') return
    try {
        bot.setControlState('forward', keys.forward)
        bot.setControlState('back', keys.back)
        bot.setControlState('left', keys.left)
        bot.setControlState('right', keys.right)
        bot.setControlState('jump', keys.jump)
        bot.setControlState('sprint', keys.sprint)
        bot.setControlState('sneak', keys.sneak)
    } catch (e) {}
}, 50)

// ==========================================
// ROUTES
// ==========================================

// ping - used by Roblox to check if server is awake
app.get('/ping', (req, res) => {
    res.json({ alive: true, botStatus })
})

// connect bot to a minecraft server
app.post('/connect', (req, res) => {
    const { host, port, username } = req.body
    if (!host) return res.status(400).json({ error: 'host required' })
    createBot(host, port, username)
    res.json({ ok: true, message: 'Bot connecting...' })
})

// disconnect bot
app.post('/disconnect', (req, res) => {
    if (bot && typeof bot.quit === 'function') {
  bot.quit()
  bot = null
}   
    bot.on('end', () => {
  botStatus = 'disconnected'
})   
    res.json({ ok: true })
})

// key press/release
app.post('/key', (req, res) => {
    if (!bot || botStatus !== 'connected')
        return res.status(400).json({ error: 'bot not connected' })

    const { key, state } = req.body

    if (keys.hasOwnProperty(key)) {
        keys[key] = state === true
    }

    if (key === 'attack' && state === true) {
        bot.attack(bot.nearestEntity())
    }

    if (key === 'use' && state === true) {
        bot.activateItem()
    }
    const hotbarMap = {
        One: 0, Two: 1, Three: 2, Four: 3, Five: 4,
        Six: 5, Seven: 6, Eight: 7, Nine: 8
    }
    if (hotbarMap.hasOwnProperty(key) && state === true) {
        bot.setQuickBarSlot(hotbarMap[key])
    }

    res.json({ ok: true })
})

// look direction
app.post('/look', (req, res) => {
    if (!bot || botStatus !== 'connected')
        return res.status(400).json({ error: 'bot not connected' })

    const { yaw, pitch } = req.body
    bot.look(yaw, pitch, true)
    res.json({ ok: true })
})

// chat
app.post('/chat', (req, res) => {
    if (!bot || botStatus !== 'connected')
        return res.status(400).json({ error: 'bot not connected' })

    const { message } = req.body
    if (!message) return res.status(400).json({ error: 'message required' })
    bot.chat(message)
    res.json({ ok: true })
})

// bot status
app.get('/status', (req, res) => {
    res.json({
        botStatus,
        health: bot?.health ?? null,
        food: bot?.food ?? null,
        position: bot?.entity?.position ?? null,
        username: bot?.username ?? null
    })
})

app.get('/messages', (req, res) => {
    res.json({ messages: chatLog })
})

app.get('/inventory', (req, res) => {
    if (!bot || botStatus !== 'connected') return res.json({ slots: [] })
    const slots = bot.inventory.slots
        .filter(item => item != null)
        .map(item => ({ name: item.name, count: item.count, slot: item.slot }))
    res.json({ slots })
})

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Bot vision available at your Render URL once bot is connected`)
})
