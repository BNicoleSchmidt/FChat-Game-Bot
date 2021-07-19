const Fchat = require("lib-fchat/lib/Fchat");
const config = require("./config");
const connectionInfo = require("./connection_info");

var fchat = new Fchat(config);

const playerTracker = {}
const channelTracker = {}

function wrapInUserTags(character) {
    return `[user]${character}[/user]`
}

function boldText(text) {
    return `[b]${text}[/b]`
}

function formatCommands(commands) {
    return commands.map(boldText).join(', ')
}

function currentPlayersList(channel) {
    const players = playerTracker[channel]
    const plural = players.length !== 1
    return players.length ? `There ${plural ? 'are' : 'is'} currently ${players.length} player${plural ? 's' : ''}:\n${players.map(wrapInUserTags).join('\n')}` : 'No one is currently playing.'
}

function sendMSG(channel, message) {
    fchat.send('MSG', { channel, message })
}

function addPlayer(character, channel) {
    if (!playerTracker[channel].includes(character)) {
        playerTracker[channel].push(character)
        sendMSG(channel, `${wrapInUserTags(character)} has joined the game! ${currentPlayersList(channel)}`)
    } else {
        sendMSG(channel, `You're already in the game, ${wrapInUserTags(character)}!`)
    }
}

function removePlayer(character, channel, disconnect = false) {
    if (playerTracker[channel].includes(character)) {
        playerTracker[channel] = playerTracker[channel].filter(c => c !== character)
        sendMSG(channel, `${wrapInUserTags(character)} has left the game. ${currentPlayersList(channel)}`)
    } else if (!disconnect) {
        sendMSG(channel, `You're already not in the game, ${wrapInUserTags(character)}.`)
    }
}

function spin(character, channel) {
    const channelInfo = channelTracker[channel]
    const requiredPlayers = channelInfo.preventSpinback ? 4 : 3
    if (!playerTracker[channel].includes(character)) {
        sendMSG(channel, `You can't spin if you aren't playing, ${wrapInUserTags(character)}! Join the game first!`)
    } else if (playerTracker[channel].length < requiredPlayers) {
        sendMSG(channel, `There aren't enough players in the game. ${requiredPlayers} players are required in order to spin. ${currentPlayersList(channel)}`)
    } else {
        const eligiblePlayers = playerTracker[channel].filter(c => c !== character && (!channelInfo.preventSpinback || c !== channelInfo.lastSpinner))
        const chosenPlayer = eligiblePlayers[Math.floor(Math.random() * (eligiblePlayers.length))]
        sendMSG(channel, `${wrapInUserTags(character)} spins the bottle! It points to... ${wrapInUserTags(chosenPlayer)}!`)
        channelInfo.lastSpinner = character
    }
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
    // [session=Bot test - ignore me]adh-34e712245998e51b61e3[/session]

    fchat.send("JCH", { channel: 'adh-3d665c7ad3a74fcd1b4b' });
    fchat.send("JCH", { channel: 'adh-34e712245998e51b61e3' });
    // fchat.send("JCH", { channel: 'development' });
})

fchat.on("JCH", ({channel, character, title}) => {
    if (character.identity === 'Game Bot') {
        console.log('Joined channel', title)
        playerTracker[channel] = []
        channelTracker[channel] = {preventSpinback: channel.toLowerCase() === 'adh-3d665c7ad3a74fcd1b4b'}
    }
})

fchat.on("LCH", ({channel, character}) => {
    removePlayer(character, channel, true)
})

fchat.on("FLN", ({character}) => {
    const allChannels = Object.keys(playerTracker)
    for (const channel of allChannels) {
        removePlayer(character, channel, true)
    }
})

const joinCommands = ['!yesspin', '!optin', '!join']
const leaveCommands = ['!nospin', '!optout', '!leave']
const statusCommands = ['!ready', '!status', '!players', '!playing']
const bottleSpinCommands = ['!spin', '!bottle']
const spinbackCommands = ['!spinback', '!togglespinback']
const helpCommands = ['!help', '!commands', '!info']

fchat.on("MSG", ({character, message, channel}) => {
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
        sendMSG(channel, currentPlayersList(channel))
    } else if (spinbackCommands.includes(xmessage)) {
        newSetting = !channelTracker[channel].preventSpinback
        channelTracker[channel].preventSpinback = newSetting
        sendMSG(channel, `Spinback prevention is now ${newSetting ? 'on' : 'off'}.`)
    } else if (helpCommands.includes(xmessage)) {
        sendMSG(channel, `List of available commands:
        ${formatCommands(joinCommands)}: Join a game
        ${formatCommands(leaveCommands)}: Leave a game
        ${formatCommands(bottleSpinCommands)}: Spin the bottle
        ${formatCommands(statusCommands)}: Check current players
        ${formatCommands(spinbackCommands)}: Toggle spinback prevention
        ${formatCommands(helpCommands)}: Show this message`)
    }
})

fchat.onClose(() => {
    console.log('Connection closed')
})

fchat.connect(connectionInfo.account, connectionInfo.password, connectionInfo.character);
