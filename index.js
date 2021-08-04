const Fchat = require("lib-fchat/lib/FchatBasic");
const config = require("./config");
const random = require("./random");
const { Model } = require('objection');

class Player extends Model {
    static get tableName() {
        return 'players'
    }
}

class Item extends Model {
    static get tableName() {
        return 'items'
    }
}

class Mod extends Model {
    static get tableName() {
        return 'mods'
    }
}

class Channel extends Model {
    static get tableName() {
        return 'channels';
    }

    static get relationMappings() {
        return {
            players: {
                relation: Model.HasManyRelation,
                modelClass: Player,
                join: {
                    from: 'channels.id',
                    to: 'players.channel_id'
                }
            },
            mods: {
                relation: Model.HasManyRelation,
                modelClass: Mod,
                join: {
                    from: 'channels.id',
                    to: 'mods.channel_id'
                }
            }
        }
    }
}

const db_url = process.env.DATABASE_URL
var db_url_groups = db_url.match(/^.*\/\/(.*):(.*)@(.*):.*\/(.*)$/)
var dbUser = db_url_groups[1]
var dbPw = db_url_groups[2]
var dbHost = db_url_groups[3]
var db = db_url_groups[4]

const dbInfo = {
    client: 'pg',
    useNullAsDefault: true,
    connection: {
        host: `${dbHost}`,
        user: `${dbUser}`,
        password: `${dbPw}`,
        database: `${db}`,
        ssl: {
            rejectUnauthorized: false
        }
    }
}

const Knex = require('knex');

const knex = Knex(dbInfo);
Model.knex(knex);

var fchat = new Fchat(config);

const messageQueue = []
const deathRollTracker = {}
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
    const players = channel.players
    const plural = players.length !== 1
    return players.length ? `There ${plural ? 'are' : 'is'} currently ${players.length} player${plural ? 's' : ''}.` : 'No one is currently playing.'
}

function currentPlayersList(channel) {
    return `Current players in ${channel.title}: \n${channel.players.map(p => wrapInUserTags(p.character)).join('\n')}`
}

function sendMSG(channel, message) {
    messageQueue.push({ code: 'MSG', payload: { channel, message } })
}

function sendPRI(recipient, message) {
    messageQueue.push({ code: 'PRI', payload: { recipient, message } })
}

async function addPlayer(character, channel) {
    const players = (await Player.query().where('channel_id', channel)).map(p => p.character)
    if (!players.includes(character)) {
        await Player.query().insert({ character, channel_id: channel }).returning(['character'])
        const channelInfo = await Channel.query().findById(channel).withGraphFetched('players')
        sendMSG(channel, `${wrapInUserTags(character)} has joined the game! ${currentPlayersCount(channelInfo)}`)
    } else {
        sendMSG(channel, `You're already in the game, ${wrapInUserTags(character)}!`)
    }
}

async function removePlayer(character, channel, disconnect = false) {
    const players = (await Player.query().where('channel_id', channel)).map(p => p.character)
    if (players.includes(character)) {
        await Player.query().where('character', character).where('channel_id', channel).delete()
        const channelInfo = await Channel.query().findById(channel).withGraphFetched('players')
        sendMSG(channel, `${wrapInUserTags(character)} has left the game. ${currentPlayersCount(channelInfo)}`)
    } else if (!disconnect) {
        sendMSG(channel, `You're already not in the game, ${wrapInUserTags(character)}.`)
    }
}

function getRandom(options) {
    return options[Math.floor(Math.random() * (options.length))]
}

async function spin(character, channel) {
    const channelInfo = await Channel.query().findById(channel).withGraphFetched('players')
    const players = channelInfo.players.map(p => p.character)
    const requiredPlayers = channelInfo.spinback ? 4 : 3
    if (!players.includes(character)) {
        sendMSG(channel, `You can't spin if you aren't playing, ${wrapInUserTags(character)}! Join the game first!`)
    } else if (players.length < requiredPlayers) {
        sendMSG(channel, `There aren't enough players in the game. ${requiredPlayers} players are required in order to spin. ${currentPlayersCount(channelInfo)}`)
    } else {
        const eligiblePlayers = players.filter(c => c !== character && (!channelInfo.spinback || c !== channelInfo.last_spinner))
        const chosenPlayer = getRandom(eligiblePlayers)
        sendMSG(channel, `${wrapInUserTags(character)} spins the bottle! It points to... ${wrapInUserTags(chosenPlayer)}!`)
        await Channel.query().findById(channel).update({last_spinner: character})
    }
}

function randomNumber(maximum) {
    return Math.floor(Math.random() * maximum) + 1
}

function getRandomItem(category) {
    return getRandom(random[category])
}

function rollDice(dice, character, channel) {
    if (dice.includes('rick')) {
        sendMSG(channel, `${wrapInUserTags(character)} rolls the Rick: [url=https://www.youtube.com/watch?v=dQw4w9WgXcQ]Roll[/url] [eicon]rickroll[/eicon]`)
        return
    }
    let count = 1
    let sides
    if (dice.includes('d')) {
        count = parseInt(dice.split('d')[0], 10)
        sides = parseInt(dice.split('d')[1], 10)
    } else {
        sides = parseInt(dice, 10)
    }
    if (isNaN(count) || isNaN(sides) || count <= 0 || sides <= 0) {
        sendMSG(channel, 'What?')
    } else if (count > 20) {
        sendMSG(channel, "That's too many dice. No.")
    } else {
        let result
        if (count === 1) {
            result = randomNumber(sides)
        } else {
            const rolls = []
            for (let i = 0; i < count; i++) {
                rolls.push(randomNumber(sides))
            }
            result = `${rolls.join(' ')} = ${rolls.reduce((a, b) => a + b, 0)}`
        }
        sendMSG(channel, `${wrapInUserTags(character)} rolls ${count}d${sides}: ${boldText(result)}`)
    }
}

function performDeathRoll(dice, character, channel) {
    const result = randomNumber(dice)
    if (result === 1) {
        delete deathRollTracker[channel]
        sendMSG(channel, `DEATH ROLL: ${wrapInUserTags(character)} rolls ${boldText(1)}! [eicon]blobcatbongoping[/eicon]`)
    } else {
        deathRollTracker[channel] = result
        sendMSG(channel, `DEATH ROLL: ${wrapInUserTags(character)} rolls ${boldText(result)}!`)
    }
}

function deathRoll(message, character, channel) {
    const startArgument = message.split(' ')[1]
    if (startArgument) {
        const dice = parseInt(startArgument, 10)
        if (isNaN(dice) || dice < 2) {
            sendMSG(channel, 'Death rolls must start at a minimum of 2.')
        } else if (dice > 1000) {
            sendMSG(channel, 'Death rolls must start at 1000 or lower. (Spam prevention)')
        } else {
            performDeathRoll(dice, character, channel)
        }
    } else if (deathRollTracker[channel]) {
        performDeathRoll(deathRollTracker[channel], character, channel)
    } else {
        sendMSG(channel, 'There is no Death Roll in progess. Please provide a starting number.')
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

fchat.on("CON", async () => {
    const channels = await Channel.query()
    for (const channel of channels) {
        fchat.send('JCH', { channel: channel.id })
    }
})

fchat.on("JCH", async ({ channel, character, title }) => {
    if (character.identity === 'Game Bot') {
        console.log('Joined channel', title)
        const existing = await Channel.query().findById(channel)
        if (!existing) {
            await Channel.query().insert({id: channel, title, spinback: true})
        }
    }
})

fchat.on("LCH", async ({ channel, character }) => {
    await removePlayer(character, channel, true)
})

fchat.on("FLN", async ({ character }) => {
    const channels = (await Player.query().where('character', character)).map(p => p.channel_id)
    for (const channel of channels) {
        await removePlayer(character, channel, true)
    }
})

const joinCommands = ['!yesspin', '!optin', '!join']
const leaveCommands = ['!nospin', '!optout', '!leave']
const statusCommands = ['!ready', '!status', '!players', '!playing', '!list']
const bottleSpinCommands = ['!spin', '!bottle']
const spinbackCommands = ['!spinback', '!togglespinback']
const helpCommands = ['!help', '!commands', '!info']
const randomItemCommands = ['!food', '!berry', '!drink', '!potion', '!toy', '!bondage']
const coinCommands = ['!coin', '!flip', '!coinflip', '!flipcoin']

fchat.on("MSG", async ({ character, message, channel }) => {
    const xmessage = message.toLowerCase().trim()
    if (xmessage.includes('hey game bot')) {
        sendMSG(channel, `Hey yourself, ${wrapInUserTags(character)}!`)
    } else if (joinCommands.includes(xmessage)) {
        await addPlayer(character, channel)
    } else if (leaveCommands.includes(xmessage)) {
        await removePlayer(character, channel)
    } else if (bottleSpinCommands.includes(xmessage)) {
        await spin(character, channel)
    } else if (coinCommands.includes(xmessage)) {
        sendMSG(channel, `${wrapInUserTags(character)} flips a coin! It comes up ${boldText(color(getRandom(['heads!', 'tails!']), 'blue'))}`)
    } else if (statusCommands.includes(xmessage)) {
        const existingChannel = await Channel.query().findById(channel).withGraphFetched('players')
        sendMSG(channel, currentPlayersCount(existingChannel))
        if (existingChannel.players.length) {
            sendPRI(character, currentPlayersList(existingChannel))
        }
    } else if (spinbackCommands.includes(xmessage)) {
        const existing = await Channel.query().findById(channel)
        newSetting = !existing.spinback
        await Channel.query().findById(channel).update({spinback: newSetting})
        sendMSG(channel, `Spinback prevention is now ${newSetting ? 'on' : 'off'}.`)
    } else if (randomItemCommands.includes(xmessage)) {
        sendMSG(channel, `/me produces a ${boldText(color(getRandomItem(xmessage), 'blue'))}!`)
    } else if (xmessage.startsWith("!8ball")) {
        const result = getRandomItem('8ball')
        sendMSG(channel, `Magic 8 Ball says: ${boldText(color(result.text, result.color))}`)
    } else if (xmessage.startsWith('!roll')) {
        const dice = xmessage.substr(5)
        rollDice(dice, character, channel)
    } else if (xmessage.startsWith('!dr')) {
        deathRoll(xmessage, character, channel)
    } else if (helpCommands.includes(xmessage)) {
        sendMSG(channel, `List of available commands:
        ${formatCommands(joinCommands)}: Join a game
        ${formatCommands(leaveCommands)}: Leave a game
        ${formatCommands(statusCommands)}: Check current players
        ${formatCommands(bottleSpinCommands)}: Spin the bottle
        ${formatCommands(coinCommands)}: Flip a coin
        ${formatCommands(['!roll #', '!roll #d#'])}: Roll dice
        ${formatCommands(['!dr #', '!dr'])}: Start or continue a Death Roll
        ${formatCommands(['!8ball', '!8ball <question>'])}: Seek answers from a higher power
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