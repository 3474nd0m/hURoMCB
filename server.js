// why do i do this to myself?

const http = require('http')
const express = require('express')
const mineflayer = require('mineflayer')
const { mineflayerViewer } = require('prismarine-viewer')
let intentionalDisconnect = false // i moved it guys
const net = require('net')
// const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
  let lastHost, lastPort, lastUsername
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

function testConnection(host, port, timeout = 5000) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port, timeout })
        socket.once('connect', () => { socket.destroy(); resolve(true) })
        socket.once('error', () => { socket.destroy(); resolve(false) })
        socket.once('timeout', () => { socket.destroy(); resolve(false) })
    })
}

// ==========================================
// BOT CREATION
// ==========================================

function createBot(host, port, username) {
    lastHost = host; lastPort = port; lastUsername = username
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
        version: '1.21.10',
        auth: 'offline',  // ADD THIS
        hideErrors: false,
        // keepAlive: true, // please poll tyty
        checkTimeoutInterval: 60000
    })

    // bot.on('physicsTick', () => {}) // keep bot active
    
    bot.once('spawn', () => {
        botStatus = 'connected'
        try {
            const { mineflayerViewer } = require('prismarine-viewer')
            mineflayerViewer(bot, { server, firstPerson: true })
            console.log('Viewer running!')
        } catch (e) {
            console.log('Viewer failed to load, continuing without it:', e.message)
        }
    })

    bot.on('error', (err) => {
        botStatus = 'error'
        console.error('Bot error:', err.message)
    })

    let retryCount = 0
    const MAX_RETRIES = 3
    
    // in bot.on('end')
    bot.on('end', (why) => {
        botStatus = 'disconnected'
      console.log('ok i end now and why is', why)
        bot = null
        if (!intentionalDisconnect && retryCount < MAX_RETRIES) {
            retryCount++
            setTimeout(() => createBot(lastHost, lastPort, lastUsername), 5000)
        } else {
            intentionalDisconnect = false
            retryCount = 0
        }
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

// add this one - fires before spawn
bot._client.on('session', () => console.log('🔑 Session established'))
bot._client.on('connect', () => console.log('🔌 TCP connected'))
bot._client.on('disconnect', (packet) => console.log('📦 Disconnect packet:', packet))

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
    
    const reachable = await testConnection(host, port || 25565)
    if (!reachable) return res.status(400).json({ error: 'server unreachable' })
    
    createBot(host, port, username)
    res.json({ ok: true, message: 'Bot connecting...' })
})

// in your /disconnect route
app.post('/disconnect', (req, res) => {
    intentionalDisconnect = true
    if (bot && typeof bot.quit === 'function') {
        const b = bot
        bot = null
        botStatus = 'disconnected'
        b.on('end', () => {})
        b.quit()
    }
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
