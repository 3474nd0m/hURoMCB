// why do i do this to myself?

const http = require('http')
const express = require('express')
const mineflayer = require('mineflayer')
const { mineflayer: viewerFunc } = require('prismarine-viewer')
const { createProxyMiddleware } = require('http-proxy-middleware')
const net = require('net')

const retryCounts = {}

const app = express()
const server = http.createServer(app)

const PORT = process.env.PORT || 3000 // moved him here say hi

const cors = require('cors')
app.use(cors())

app.use(express.json())
app.use('/view', createProxyMiddleware({
    target: 'http://localhost:' + (PORT+1),
    changeOrigin: true,
    ws: true
}))

// ==========================================
// PER-PLAYER STATE
// ==========================================

const bots = {}
const botStatuses = {}
const chatLogs = {}
const lastHosts = {}
const lastPorts = {}
const lastUsernames = {}
const keyStates = {}
const miningLoops = {}
const isDiggings = {}
const intentionalDisconnects = {}
const viewerServers = {}

function getKeys(playerId) {
    if (!keyStates[playerId]) {
        keyStates[playerId] = {
            forward: false, back: false, left: false, right: false,
            jump: false, sprint: false, sneak: false, ctrl: false
        }
    }
    return keyStates[playerId]
}

// ==========================================
// CONNECTION TEST
// ==========================================

function testConnection(host, port, timeout = 5000) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port, timeout })
        socket.once('connect', () => { socket.destroy(); resolve(true) })
        socket.once('error', () => { socket.destroy(); resolve(false) })
        socket.once('timeout', () => { socket.destroy(); resolve(false) })
    })
}

// ==========================================
// CHAT FORMAT
// ==========================================

function formatMessage(jsonMsg, format = 'roblox') {
    const colorMap = {
        '0': { roblox: '#000000', godot: '000000' },
        '1': { roblox: '#0000AA', godot: '0000AA' },
        '2': { roblox: '#00AA00', godot: '00AA00' },
        '3': { roblox: '#00AAAA', godot: '00AAAA' },
        '4': { roblox: '#AA0000', godot: 'AA0000' },
        '5': { roblox: '#AA00AA', godot: 'AA00AA' },
        '6': { roblox: '#FFAA00', godot: 'FFAA00' },
        '7': { roblox: '#AAAAAA', godot: 'AAAAAA' },
        '8': { roblox: '#555555', godot: '555555' },
        '9': { roblox: '#5555FF', godot: '5555FF' },
        'a': { roblox: '#55FF55', godot: '55FF55' },
        'b': { roblox: '#55FFFF', godot: '55FFFF' },
        'c': { roblox: '#FF5555', godot: 'FF5555' },
        'd': { roblox: '#FF55FF', godot: 'FF55FF' },
        'e': { roblox: '#FFFF55', godot: 'FFFF55' },
        'f': { roblox: '#FFFFFF', godot: 'FFFFFF' },
    }

    const text = jsonMsg.getText ? jsonMsg.getText() : jsonMsg.toString()

    // strip § codes and rebuild with target format
    let result = ''
    let i = 0
    let openTag = false

    while (i < text.length) {
        if (text[i] === '§' && i + 1 < text.length) {
            const code = text[i + 1].toLowerCase()
            if (openTag) {
                result += format === 'godot' ? '[/color]' : '</font>'
                openTag = false
            }
            if (colorMap[code]) {
                const color = colorMap[code][format]
                result += format === 'godot'
                    ? `[color=#${color}]`
                    : `<font color="${colorMap[code].roblox}">`
                openTag = true
            }
            i += 2
        } else {
            result += text[i]
            i++
        }
    }

    if (openTag) {
        result += format === 'godot' ? '[/color]' : '</font>'
    }

    return result
}

// ==========================================
// BOT CREATION
// ==========================================

function createBot(playerId, host, port, username) {
    lastHosts[playerId] = host
    lastPorts[playerId] = port
    lastUsernames[playerId] = username
    console.log(`🤖 [${playerId}] Creating bot: ${host}:${port} as ${username}`)

    const existing = bots[playerId]
    if (existing && typeof existing.quit === 'function') {
        existing.quit()
        bots[playerId] = null
    }

    botStatuses[playerId] = 'connecting'
    chatLogs[playerId] = []
    miningLoops[playerId] = null
    isDiggings[playerId] = false

    const bot = mineflayer.createBot({
        host: host || 'localhost',
        port: port || 25565,
        username: username || 'hURoMCB-nilname',
        version: false,
        auth: 'offline',
        hideErrors: false,
    })

    bots[playerId] = bot

    bot._client.on('session', () => console.log(`🔑 [${playerId}] Session established`))
    bot._client.on('connect', () => console.log(`🔌 [${playerId}] TCP connected`))
    bot._client.on('disconnect', (packet) => console.log(`📦 [${playerId}] Disconnect:`, packet))

	bot.once('spawn', () => {
	    botStatuses[playerId] = 'connected'
 		console.log(`✅ [${playerId}] Spawned!`)
   			if (!viewerServers[playerId]) {  // ← add this guard
   		    	try {
	        	const viewer = viewerFunc(bot, { port: parseInt(PORT)+1, firstPerson: true })
            	viewerServers[playerId] = viewer
            	console.log('Viewer running!')
        	} catch (e) {
	            console.log('Viewer failed:', e.message)
    	    }
    	}
	})


	bot.on('error', (err) => {
		botStatuses[playerId] = 'error'
		console.error(`❌ [${playerId}] Bot error:`, err.message)
		if (!bots[playerId]) return
		bots[playerId] = null
		if (!intentionalDisconnects[playerId] && retryCounts[playerId] < MAX_RETRIES) {
			retryCounts[playerId]++
			setTimeout(() => createBot(playerId, lastHosts[playerId], lastPorts[playerId], lastUsernames[playerId]), 10000)
		}
	})

	if (!retryCounts[playerId]) retryCounts[playerId] = 0
		const MAX_RETRIES = 3


    bot.on('end', (why) => {
        botStatuses[playerId] = 'disconnected'
        console.log(`🔴 [${playerId}] ended, reason:`, why)
        bots[playerId] = null
        miningLoops[playerId] = null
        isDiggings[playerId] = false
        if (viewerServers[playerId]) {
					try {
			viewerServers[playerId].close()
				} catch (e) {}
			viewerServers[playerId] = null
		}
        if (!intentionalDisconnects[playerId] && retryCounts[playerId] < MAX_RETRIES) {
            retryCounts[playerId]++
            setTimeout(() => createBot(playerId, lastHosts[playerId], lastPorts[playerId], lastUsernames[playerId]), 5000)
        } else {
            intentionalDisconnects[playerId] = false
            retryCounts[playerId] = 0
        }
    })

    bot.on('kicked', (reason) => {
        botStatuses[playerId] = 'disconnected'
        console.log(`👢 [${playerId}] Kicked:`, reason)
        bots[playerId] = null
    })

    bot.on('message', (jsonMsg) => {
        const msg = jsonMsg.toString()
        console.log(`💬 [${playerId}]:`, msg)
        if (!chatLogs[playerId]) chatLogs[playerId] = []
        chatLogs[playerId].push(msg)
        if (chatLogs[playerId].length > 50) chatLogs[playerId].shift()
    })
}

// ==========================================
// MOVEMENT LOOP
// ==========================================

setInterval(() => {
    for (const playerId in bots) {
        const bot = bots[playerId]
        if (!bot || botStatuses[playerId] !== 'connected') continue
        const keys = getKeys(playerId)
        try {
            bot.setControlState('forward', keys.forward)
            bot.setControlState('back', keys.back)
            bot.setControlState('left', keys.left)
            bot.setControlState('right', keys.right)
            bot.setControlState('jump', keys.jump)
            bot.setControlState('sprint', keys.sprint)
            bot.setControlState('sneak', keys.sneak)
        } catch (e) {}
    }
}, 50)

// ==========================================
// ROUTES
// ==========================================

app.get('/', (req, res) => {
	res.send(`<pre>
Welcome to /

GET  /                                         - User, take a wild FUCKING guess where you are right now.
GET  /ping                                     - shows if the server is online. I mean, you can see this, so it probably is.
GET  /status?playerId=x                        - gets bot status, health, position, etc -playerId: who bro is
GET  /messages?playerId=x                      - gets chat log -playerId: ...who bro is
GET  /inventory?playerId=x                     - gets inventory slots -playerId: bro
GET  /minimap/:playerId?chunk=y                - tiny xaero's minimap basically in PNG -:playerId_ who is bro -chunk: render distance (WIP)
GET  /chunkview/:playerId?chunk=y              - 3D chunk view PNG -chunk: render distance -:playerId_ take a wild guess gng (WIP)
GET  /thestory/:vol?page=y                     - hUX2MCB, lore accurate story from the sentinelcraft book -:vol_ volume (basically, season) -page: ...page. (WIP)

POST /connect {playerId, host, port, username} - connects bot
POST /disconnect {playerId}                    - disconnects bot 
POST /key {playerId, key, state}               - sends key input 
POST /look {playerId, yaw, pitch}              - sets yaw/pitch 
POST /chat {playerId, message}                 - sends chat message

	</pre>`)
})

app.get('/thestory', (req, res) => {
  res.send(`<pre>Please wait for 001 to retrieve the book. Thank you for your patience.</pre>`)
})

app.get('/thestory/:vol', (req, res) => {
	const { vol } = req.params
	const { page } = req.query
	if (vol == '1') {
		if (page == '1') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
       --= hUX2MCB =--
I had a dream. When I was a
kid, I always wanted to know
what it was like playing
Minecraft.
But unfortunately, because of
the game being paid, and my
parents probably going to
refuse me playing it, so the
idea was scrapped.

However, that was...

I had an idea.</pre>`)
		} else if (page == '2') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
       --= hUX2MCB =--
8 years later, I had an idea.
A vision. And I know it could
work. It has to. Using my
knowledge on UI, UX, and HTTP
requests, I got to work.
I booted up Roblox Studio,
booted up VSCode, and got to
work.
"5 year old me is going to be
so proud..." I thought to
myself.

He sure would, wouldn't he?</pre>`)
		} else if (page == '3') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
After days of self-doubt,
optimism, and hope... it was
done. I made it. HuRoMCB. Of
course, it was nothing flashy,
but it was something. And
after testing, it worked. I
finally connected to a
Minecraft server.
The server was empty, as
always, just me and... this
other guy. This was all I
needed.
...why is there so much pages?</pre>`)
		} else if (page == '4') {
		res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
Well, this... other guy didn't
seem to mind I did nothing. I
couldn't see his chats for
some reason, and I didn't do
the captcha, so after a bit, I
got kicked out. After my exit,
I could (for some reason)
&lt;i&gt;feel&lt;/i&gt; the next guy that's
about to join buzz with
excitement about my existance.
Can't blame him, I would too.

But then, why would he?</pre>`)
		} else if (page == '5') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
I continued meticuliously
testing and stress pressing,
joining and leaving the server
until I was satasified.
Until, I got a bit cocky, and I
didn't check the playerlist
when I joined.

Shit. I was caught.

While someone that had the
same name as me and his
friend were playing.</pre>`)
		} else if (page == '6') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
"Wait,&lt;br/&gt;MarcoMC2009...
Marco_IDK001...&lt;br/&gt;it's kinda
sus" RealCBroTwo observed
almost instantly.
"idk man could be a
coincidence&lt;br/&gt;theres a lotta
people named marco nowadays"
MarcoMC2009 defended.

I stood like a deer in
headlights. I mean, in this
situation,
What could I do?</pre>`)
		} else if (page == '7') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
Nothing, exactly.
The two continued arguing
about if I was either an
unfortunate player, an alt
account, or a bot.
And after a few minutes of
absolute stillness, I timed out.
I actually left, but lets
pretend it was the former
instead.

I set some tings, but what I
needed was to process allat.
</pre>`)
		} else if (page == '8') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
I tweak a few settings, add a
few more, and at this point,
they already know. Why check
the playerlist at this point?
"well speak of the devil"
MarcoMC2009 points out.

...I don't remember what
happened after that, but I
still remained completely
still. Plus, yet again,

What was I supposed to do?</pre>`)
		} else if (page == '9') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
I joined again, still testing,
until suddenly, MarcoMC2009
reveals the truth.
"listen&lt;br/&gt;001, you aren't
supposed to exist" 2009
admits.
&lt;i&gt;not &lt;b&gt;supposed&lt;/b&gt; &lt;/i&gt;to? 
how does that work?&lt;/i&gt; I wanted
to tell them. But they
answered for me.
"you're a bit of an...
experiment. i made you, and i
know you arent stable yet."</pre>`)
		} else if (page == '10') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
&lt;i&gt;...wha-?&lt;/i&gt; I questioned
them once more, before getting
abducted.
"no time to explain, just go-!"
2009 responded instantly,
dragging me... somewhere.

I "look" around.
I see nothing, but at the same
time I saw everything I needed
to.

I've been captured.
</pre>`)
		} else if (page == '11') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
Although it isn't the worst
thing in the world. He isn't
that strict about it, which,
thank goodness. All he wants
me to do is see what I can
and can't do, thats really it.

Although hey, one more person
is helping with me checking
what I can and can't do, I had
one question I couldn't say.

Why?</pre>`)
		} else if (page == '12') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hURoMCB =--
Why did 2009 drag me into
this? Why me specificially?
Why this? I keep my mouth
shut, since I ain't complaining.

From time to time, I do let
my sassiness out, simply
because... why not? And
thankfully, 2009 was very
forgiving. However, something
unexpected happened.

An update?
</pre>`)
		} else if (page == '13') {
			res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
 --= hU2MCB - hURo/GDMCB =--
Yup, an update. Everything was
perfect, until there was a
problem, that this time, wasn't
about the bot. It was the
platform.
Roblox is rolling out Roblox
Kids and Roblox Select, and
the 16+ ID publishing rule.

This affects me.
This affects hURoMCB.

This needs to move.
</pre>`)
		} else if (page == '14') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
    --= hUX2MCB ? X2 =--
Great. Now I have to find
"Roblox Studio replacements"
and pray that one's actually
good. Which, lets be real,
they're all paid, or all shit.

Of course, this replacement is
shit as well, but my standards
are so low I just want to get
this project finished.
It's prolly the one you know,

Godot.</pre>`)
		} else if (page == '15') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hUGDMCB =--
Yup. Godot. But of course, I
had to play around with it
first. And after I did... it is
absolutely GARBAGE for 3D
games. for 2D games, despite
being a Vector2 instead of a
UDim2, it was... fine?
Good enough for this project
anyway. So, I started migrating
hURoMCB.

And, sure, it took a damn
while, but it sure is there.</pre>`)
		} else if (page == '16') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hUGDMCB =--
Continuing my tests, I can do
a lot of things. Probably most
of what a player can do.
Except the UI. I escaped my
confines, just to be put in a
bigger one. But overall, things
were great, and I wish to be
accepted into a server one
day.

However, 2009 wouldn't give me
that.
So I'll get it myself.</pre>`)
		} else if (page == '17') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hUGDMCB =--
I started to try and escape
my confines' confines, escaping
the server itself and into
where I want to be.

I broke the glass chaimber,
but all I was met with... was
more glass.

I left.
And I joined.
And I returned.</pre>`)
		} else if (page == '18') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hUGDMCB =--
"hey guys\nmissed me?" I ask.
...I dont see a response. Only
tags and names. "[G] [M]
MarcoMC2009", what the fuck is
that supposed to mean?
I don't see a reason for me to
be here if noone's gonna say
anything and there's nothing
cool to do, so I just leave.

But there still is one thing I
must have answered. It's
starting to keep me up.
</pre>`)
		} else if (page == '19') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
  --= hUX2MCB - hUGDMCB =--
Why is he helping [i]me[/i] out
of all people?
Eventually, I had the courage
to ask. "Why did you help me?"
"long story", 2009 answers.
"i'll give you 20 iron in
sentinelcraft"

After a short moment of
silence, 2009 responded.

"ok fine i'll spill just hollon
lemme make a campfire"</pre>`)
		} else if (page == '20') {
res.send(`<pre>
Vol: ${vol}, Page: ${page ?? "?"}
"I used to have a dream like
yours once."

TBC since sentinelcraft does
not want me to write a book
longer than 20 minutes >:

thx for reading tho ^o^

ps: ik we're on render now
but this was made on a mc
book soo still cuts here lol
</pre>`)
		} else { res.send(`<res><i>thats all folks!</i></res>`) }
	} else if (vol == '2') {
	res.send(`<pre>
i didnt finish volume 2
Vol: ${vol}, Page: ${page ?? "?"}
</pre>`)	
	} else {
	res.send(`<pre>
Invalid Paramaters. Go back some pages, or go to volume 2 if you finished volume 1.
Vol: ${vol}, Page: ${page ?? "?"}
</pre>`) }
})


app.get('/ping', (req, res) => {
    res.json({ alive: true })
})

app.get('/status', (req, res) => {
    const { playerId } = req.query
    if (!playerId) return res.status(400).json({ error: 'playerId required' })
    const bot = bots[playerId]
    res.json({
        botStatus: botStatuses[playerId] || 'disconnected',
        health: bot?.health ?? null,
        food: bot?.food ?? null,
        position: bot?.entity?.position ?? null,
        username: bot?.username ?? null
    })
})

const { createCanvas } = require('canvas')

// basic block color map
const blockColors = {
	air: null,
	water: '#3F76E4',
	lava: '#FF6600',
	grass_block: '#5D9E3A',
	dirt: '#8B5E3C',
	stone: '#888888',
	sand: '#E8D8A0',
	gravel: '#9A9A9A',
	wood: '#8B5E3C',
	leaves: '#3A7D44',
	snow: '#FFFFFF',
	ice: '#A0C8FF',
	bedrock: '#333333',
	oak_log: '#6B4C2A',
	oak_leaves: '#3A7D44',
	birch_log: '#D0C89A',
	birch_leaves: '#80A050',
	default: '#A0A0A0'
}

function getBlockColor(blockName) {
	return blockColors[blockName] ?? blockColors.default
}

app.get('/minimap/:playerId', async (req, res) => {
	const { playerId } = req.params
	const chunkRadius = parseInt(req.query.chunk ?? 3)
	const bot = bots[playerId]
	if (!bot || botStatuses[playerId] !== 'connected')
		return res.status(400).json({ error: 'bot not connected' })

	const blockSize = 4
	const diameter = chunkRadius * 2 * 16
	const canvas = createCanvas(diameter * blockSize, diameter * blockSize)
	const ctx = canvas.getContext('2d')
	ctx.fillStyle = '#1a1a1a'
	ctx.fillRect(0, 0, canvas.width, canvas.height)

	const playerPos = bot.entity.position
	const startX = Math.floor(playerPos.x) - (chunkRadius * 16)
	const startZ = Math.floor(playerPos.z) - (chunkRadius * 16)

	for (let x = 0; x < diameter; x++) {
		for (let z = 0; z < diameter; z++) {
			const worldX = startX + x
			const worldZ = startZ + z
			// find topmost non-air block
			for (let y = 255; y >= 0; y--) {
				const block = bot.blockAt(new (require('vec3'))(worldX, y, worldZ))
				if (!block || block.name === 'air') continue
				const color = getBlockColor(block.name)
				if (!color) continue
				ctx.fillStyle = color
				ctx.fillRect(x * blockSize, z * blockSize, blockSize, blockSize)
				break
			}
		}
	}

	// draw player position as red dot
	const centerX = Math.floor(diameter / 2) * blockSize
	const centerZ = Math.floor(diameter / 2) * blockSize
	ctx.fillStyle = '#FF0000'
	ctx.fillRect(centerX, centerZ, blockSize, blockSize)

	res.setHeader('Content-Type', 'image/png')
	canvas.createPNGStream().pipe(res)
})

app.post('/connect', async (req, res) => {
    const { playerId, host, port, username } = req.body
    if (!playerId) return res.status(400).json({ error: 'playerId required' })
    if (!host) return res.status(400).json({ error: 'host required' })

    const reachable = await testConnection(host, port || 25565)
    if (!reachable) return res.status(400).json({ error: 'server unreachable' })

    createBot(playerId, host, port, username)
    res.json({ ok: true, message: 'Bot connecting...' })
})

app.post('/disconnect', (req, res) => {
    const { playerId } = req.body
    if (!playerId) return res.status(400).json({ error: 'playerId required' })
    intentionalDisconnects[playerId] = true
    const bot = bots[playerId]
    if (bot && typeof bot.quit === 'function') {
        bots[playerId] = null
        botStatuses[playerId] = 'disconnected'
        bot.on('end', () => {})
        bot.quit()
    }
    res.json({ ok: true })
})

app.post('/key', (req, res) => {
    const { playerId, key, state } = req.body
    if (!playerId) return res.status(400).json({ error: 'playerId required' })
    const bot = bots[playerId]
    if (!bot || botStatuses[playerId] !== 'connected')
        return res.status(400).json({ error: 'bot not connected' })

    const keys = getKeys(playerId)

    if (keys.hasOwnProperty(key)) keys[key] = state === true

    if (key === 'ctrl') {
        keys.ctrl = state
        keys.sprint = state
    }

    if (key === 'attack' && state === true) {
        miningLoops[playerId] = setInterval(async () => {
            if (isDiggings[playerId]) return
            try {
                const block = bot.blockAtCursor(5)
                const entity = bot.nearestEntity(e => e !== bot.entity && e.type === 'mob')
                const entityDist = entity ? bot.entity.position.distanceTo(entity.position) : Infinity
                const blockDist = block ? bot.entity.position.distanceTo(block.position) : Infinity
                if (entity && entityDist < 5) {
                    bot.attack(entity)
                } else if (block && block.name !== 'air' && blockDist < 5) {
                    isDiggings[playerId] = true
                    await bot.dig(block)
                    isDiggings[playerId] = false
                }
            } catch(e) { isDiggings[playerId] = false }
        }, 100)
    }

    if (key === 'attack' && state === false) {
        if (miningLoops[playerId]) {
            clearInterval(miningLoops[playerId])
            miningLoops[playerId] = null
        }
        isDiggings[playerId] = false
        try { bot.stopDigging() } catch(e) {}
    }

    if (key === 'use' && state === true) bot.activateItem()

    const hotbarMap = {
        One: 0, Two: 1, Three: 2, Four: 3, Five: 4,
        Six: 5, Seven: 6, Eight: 7, Nine: 8
    }
    if (hotbarMap.hasOwnProperty(key) && state === true) {
        bot.setQuickBarSlot(hotbarMap[key])
    }

    if (key === 'drop' && state === true) {
        const item = bot.inventory.slots[bot.quickBarSlot + 36]
        if (!item) { res.json({ ok: true }); return }
        if (keys.ctrl) {
            bot.tossStack(item, () => {})
        } else {
            bot.toss(item.type, null, 1, () => {})
        }
    }

    if (key === 'dropAll' && state === true) {
        const item = bot.inventory.slots[bot.quickBarSlot + 36]
        if (item) bot.tossStack(item, () => {})
    }

    res.json({ ok: true })
})

app.post('/look', (req, res) => {
    const { playerId, yaw, pitch } = req.body
    if (!playerId) return res.status(400).json({ error: 'playerId required' })
    const bot = bots[playerId]
    if (!bot || botStatuses[playerId] !== 'connected')
        return res.status(400).json({ error: 'bot not connected' })
    bot.look(yaw, pitch, true)
    res.json({ ok: true })
})

app.post('/chat', (req, res) => {
    const { playerId, message } = req.body
    if (!playerId) return res.status(400).json({ error: 'playerId required' })
    const bot = bots[playerId]
    if (!bot || botStatuses[playerId] !== 'connected')
        return res.status(400).json({ error: 'bot not connected' })
    if (!message) return res.status(400).json({ error: 'message required' })
    bot.chat(message)
    res.json({ ok: true })
})

app.get('/messages', (req, res) => {
    const { playerId, format } = req.query
    if (!playerId) return res.status(400).json({ error: 'playerId required' })
    const msgs = (chatLogs[playerId] || []).map(msg => formatMessage(msg, format))
    res.json({ messages: msgs })
})

app.get('/inventory', (req, res) => {
    const { playerId } = req.query
    if (!playerId) return res.status(400).json({ error: 'playerId required' })
    const bot = bots[playerId]
    if (!bot || botStatuses[playerId] !== 'connected') return res.json({ slots: [] })
    const slots = bot.inventory.slots.map((item, index) => 
        item ? { name: item.name, count: item.count, slot: index } : null
    ).filter(item => item !== null)
    res.json({ slots })
})

// ==========================================
// START SERVER
// ==========================================

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
