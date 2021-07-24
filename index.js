const Fchat = require("lib-fchat/lib/FchatBasic");
const config = require("./config");
//const connectionInfo = require("./connection_info");
const random = require("./random")

var fchat = new Fchat(config);

const playerTracker = {}
const channelTracker = {}
const messageQueue = []
let isAlive = false

function wrapInUserTags(character) {
    return `[user]${character}[/user]`
}

function boldText(text) {
    return `[b]${text}[/b]`
}

function color(text, color) {
    return `[color=${color}]${text}[/color]`
}

function formatCommands(commands) {
    return commands.map(boldText).join(', ')
}

function currentPlayersCount(channel) {
    const players = playerTracker[channel]
    const plural = players.length !== 1
    return players.length ? `There ${plural ? 'are' : 'is'} currently ${players.length} player${plural ? 's' : ''}.` : 'No one is currently playing.'
}

function currentPlayersList(channel) {
    const players = playerTracker[channel]
    return `Current players in ${channelTracker[channel].title}: \n${players.map(wrapInUserTags).join('\n')}`
}

function sendMSG(channel, message) {
    messageQueue.push({ code: 'MSG', payload: { channel, message } })
}

function sendPRI(recipient, message) {
    messageQueue.push({ code: 'PRI', payload: { recipient, message } })
}

function addPlayer(character, channel) {
    if (!playerTracker[channel].includes(character)) {
        playerTracker[channel].push(character)
        sendMSG(channel, `${wrapInUserTags(character)} has joined the game! ${currentPlayersCount(channel)}`)
    } else {
        sendMSG(channel, `You're already in the game, ${wrapInUserTags(character)}!`)
    }
}

function removePlayer(character, channel, disconnect = false) {
    if (playerTracker[channel].includes(character)) {
        playerTracker[channel] = playerTracker[channel].filter(c => c !== character)
        sendMSG(channel, `${wrapInUserTags(character)} has left the game. ${currentPlayersCount(channel)}`)
    } else if (!disconnect) {
        sendMSG(channel, `You're already not in the game, ${wrapInUserTags(character)}.`)
    }
}

function getRandom(options) {
    return options[Math.floor(Math.random() * (options.length))]
}

function spin(character, channel) {
    const channelInfo = channelTracker[channel]
    const requiredPlayers = channelInfo.preventSpinback ? 4 : 3
    if (!playerTracker[channel].includes(character)) {
        sendMSG(channel, `You can't spin if you aren't playing, ${wrapInUserTags(character)}! Join the game first!`)
    } else if (playerTracker[channel].length < requiredPlayers) {
        sendMSG(channel, `There aren't enough players in the game. ${requiredPlayers} players are required in order to spin. ${currentPlayersCount(channel)}`)
    } else {
        const eligiblePlayers = playerTracker[channel].filter(c => c !== character && (!channelInfo.preventSpinback || c !== channelInfo.lastSpinner))
        const chosenPlayer = getRandom(eligiblePlayers)
        sendMSG(channel, `${wrapInUserTags(character)} spins the bottle! It points to... ${wrapInUserTags(chosenPlayer)}!`)
        channelInfo.lastSpinner = character
    }
}

function getRandomItem(category) {
    return getRandom(random[category])
}

fchat.onOpen(ticket => {
    console.log(`Websocket connection opened. Identifying with ticket: ${ticket}`);
});

fchat.on("IDN", () => {
    console.log(`Identification as ${fchat.user.character} Successful!`);
});

fchat.on("ERR", event => {
    console.log('ERR', event)
})

fchat.on("CON", () => {
    // [session=Truth or Dare, Pie Corner]adh-3d665c7ad3a74fcd1b4b[/session]
    // [session=Death rolls & Glory hoops]adh-2a38b045be1f83dae9c5[/session]
    // [session=Pokemon Mystery Dungeon]adh-a4369b5fe15561218d9f[/session]

    fchat.send("JCH", { channel: 'adh-3d665c7ad3a74fcd1b4b' });
    fchat.send("JCH", { channel: 'adh-2a38b045be1f83dae9c5' });
    fchat.send("JCH", { channel: 'adh-a4369b5fe15561218d9f' });
    // fchat.send("JCH", { channel: 'development' });
})

fchat.on("JCH", ({ channel, character, title }) => {
    if (character.identity === 'Game Bot') {
        console.log('Joined channel', title)
        if (!Object.keys(channelTracker).includes(channel)) {
            playerTracker[channel] = []
            channelTracker[channel] = { preventSpinback: true, title }
        }
    }
})

fchat.on("LCH", ({ channel, character }) => {
    removePlayer(character, channel, true)
})

fchat.on("FLN", ({ character }) => {
    const allChannels = Object.keys(playerTracker)
    for (const channel of allChannels) {
        removePlayer(character, channel, true)
    }
})

const joinCommands = ['!yesspin', '!optin', '!join']
const leaveCommands = ['!nospin', '!optout', '!leave']
const statusCommands = ['!ready', '!status', '!players', '!playing', '!list']
const bottleSpinCommands = ['!spin', '!bottle']
const spinbackCommands = ['!spinback', '!togglespinback']
const helpCommands = ['!help', '!commands', '!info']
const randomItemCommands = ['!food', '!berry', '!drink']

fchat.on("MSG", ({ character, message, channel }) => {
    const xmessage = message.toLowerCase().trim()
    if (xmessage === 'hey game bot') {
        sendMSG(channel, `Hey yourself, ${wrapInUserTags(character)}!`)
    } else if (joinCommands.includes(xmessage)) {
        addPlayer(character, channel)
    } else if (leaveCommands.includes(xmessage)) {
        removePlayer(character, channel)
    } else if (bottleSpinCommands.includes(xmessage)) {
        spin(character, channel)
    } else if (statusCommands.includes(xmessage)) {
        sendMSG(channel, currentPlayersCount(channel))
        if (playerTracker[channel].length) {
            sendPRI(character, currentPlayersList(channel))
        }
    } else if (spinbackCommands.includes(xmessage)) {
        newSetting = !channelTracker[channel].preventSpinback
        channelTracker[channel].preventSpinback = newSetting
        sendMSG(channel, `Spinback prevention is now ${newSetting ? 'on' : 'off'}.`)
    } else if (randomItemCommands.includes(xmessage)) {
        sendMSG(channel, `/me produces a ${boldText(color(getRandomItem(xmessage), 'blue'))}!`)
    } else if (helpCommands.includes(xmessage)) {
        sendMSG(channel, `List of available commands:
        ${formatCommands(joinCommands)}: Join a game
        ${formatCommands(leaveCommands)}: Leave a game
        ${formatCommands(bottleSpinCommands)}: Spin the bottle
        ${formatCommands(statusCommands)}: Check current players
        ${formatCommands(randomItemCommands)}: Produce a random item from the given category
        ${formatCommands(spinbackCommands)}: Toggle spinback prevention
        ${formatCommands(helpCommands)}: Show this message`)
    }
})

fchat.onClose(() => {
    console.log('Connection closed')
})

fchat.onError(err => {
    console.log('Error:', err)
})

async function connect() {
    await fchat.connect(process.env.ACCOUNT, process.env.PASSWORD, process.env.CHARACTER);
    isAlive = true
    fchat.socket.on('pong', () => isAlive = true)
}

setInterval(function ping() {
    try {
        if (isAlive === false) {
            console.log('Disconnected. Attempting reconnect.')
            connect()
        }

        isAlive = false;
        fchat.socket.ping(() => { });
    } catch (err) {
        console.log(err)
    }
}, 30000);

setInterval(function send() {
    const msg = messageQueue.shift(1)
    if (msg) {
        fchat.send(msg.code, msg.payload)
    }
}, 1001)

connect()
