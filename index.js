const startDate = new Date()
const Fchat = require("lib-fchat/lib/FchatBasic");
const config = require("./config");
const random = require("./random");
const { Model } = require('objection');

class Player extends Model {
    static get tableName() {
        return 'players'
    }
}

class Admin extends Model {
    static get tableName() {
        return 'admins'
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

const db_url = process.env.HEROKU_POSTGRESQL_BRONZE_URL
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

async function removeDeadChannels() {
    const deadChannels = await Channel.query().where({pending: true})
    await leaveChannels(deadChannels, false)
    console.log('Removed dead channels:', JSON.stringify(deadChannels.map(c => c.title)))
}

async function leaveChannels(channels, log = true) {
    const channel_ids = channels.map(c => c.id)
    await Mod.query().delete().whereIn('channel_id', channel_ids)
    await Player.query().delete().whereIn('channel_id', channel_ids)
    await Channel.query().findByIds(channel_ids).delete()
    if (log) {
        console.log('Left channels:', JSON.stringify(channels.map(c => c.title)))
    }
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1)
}

function titleCase(str) {
    return str.split(' ').map(capitalize).join(' ')
}

function wrapInUserTags(character) {
    return `[user]${character}[/user]`
}

function boldText(text) {
    return `[b]${text}[/b]`
}

function color(text, color) {
    return `[color=${color}]${text}[/color]`
}

function eicon(text) {
    return `[eicon]${text}[/eicon]`
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

async function removePlayer(character, channel, disconnect = false, kick = false) {
    const players = (await Player.query().where('channel_id', channel)).map(p => p.character.toLowerCase())
    if (players.includes(character.toLowerCase())) {
        await Player.query().whereRaw('character ILIKE ?', [character]).where('channel_id', channel).delete()
        const channelInfo = await Channel.query().findById(channel).withGraphFetched('players')
        sendMSG(channel, `${wrapInUserTags(character)} has left the game. ${currentPlayersCount(channelInfo)}`)
    } else if (!disconnect && !kick) {
        sendMSG(channel, `You're already not in the game, ${wrapInUserTags(character)}.`)
    } else if (kick) {
        sendMSG(channel, `${wrapInUserTags(character)} is not in the game.`)
    }
}

function getRandom(options) {
    return options[Math.floor(Math.random() * (options.length))]
}

function manipulateBottleOdds(players) {
    const adjustedPool = []
    for (const player of players) {
        for (let i = 0; i < player.rounds + 1; i++) {
            adjustedPool.push(player.character)
        }
    }
    return adjustedPool
}

async function updateRoundCounts(channel, players, spunPlayer, spinner) {
    await Player.query()
        .whereIn('character', players.filter(p => p.character !== spinner).map(p => p.character))
        .where('channel_id', channel)
        .increment('rounds', 1)

    await Player.query()
        .where('channel_id', channel)
        .where('character', spunPlayer)
        .update({rounds: 0})
}

async function spin(spinner, channel) {
    const channelInfo = await Channel.query().findById(channel).withGraphFetched('players')
    const players = channelInfo.players
    const requiredPlayers = channelInfo.spinback ? 4 : 3
    if (!players.map(p => p.character).includes(spinner)) {
        sendMSG(channel, `You can't spin if you aren't playing, ${wrapInUserTags(spinner)}! Join the game first!`)
    } else if (players.length < requiredPlayers) {
        sendMSG(channel, `There aren't enough players in the game. ${requiredPlayers} players are required in order to spin. ${currentPlayersCount(channelInfo)}`)
    } else {
        const eligiblePlayers = players.filter(c => c.character !== spinner && (!channelInfo.spinback || c.character !== channelInfo.last_spinner))
        const chosenCharacter = getRandom(manipulateBottleOdds(eligiblePlayers))
        sendMSG(channel, `${wrapInUserTags(spinner)} spins the bottle! It points to... ${wrapInUserTags(chosenCharacter)}!`)
        await Channel.query().findById(channel).update({last_spinner: spinner})
        await updateRoundCounts(channel, players, chosenCharacter, spinner)
    }
}

function randomNumber(maximum) {
    return Math.floor(Math.random() * maximum) + 1
}

function getRandomItem(category) {
    return getRandom(random[category])
}

function getPokemonGender(rate) {
    if (rate === -1) {
        return color('Genderless', 'gray')
    }
    return Math.floor(Math.random() * 8) < rate ? color('Female', 'pink') : color('Male', 'blue')
}

function getPokemon(channel, character) {
    const allPokemon = require("./pokemon");
    const pokemon = getRandom(allPokemon)
    const form = getRandom(pokemon.forms)
    const result = boldText(`${getPokemonGender(pokemon.genderRate)} ${form == 'normal' ? '' : color(titleCase(form), 'yellow') + ' '}${titleCase(pokemon.name)}`)
    const prefixes = ['How about', 'Maybe', 'Try', 'Perhaps', 'Ever thought about', 'Why not']
    sendMSG(channel, `${getRandom(prefixes)} ${result}, ${wrapInUserTags(character)}?`)
}

function twister(channel) {
    const ccolor = getRandom(['red', 'yellow', 'green', 'blue'])
    const side = getRandom(['Right', 'Left'])
    const limb = getRandom(['Hand', 'Foot'])
    sendMSG(channel, `The spinner points to: ${boldText(`${side} ${limb} ${color(capitalize(ccolor), ccolor)}!`)}`)
}

function rollDice(dice, character, channel) {
    if (dice.includes('rick')) {
        sendMSG(channel, `${wrapInUserTags(character)} rolls the Rick: [url=https://www.youtube.com/watch?v=dQw4w9WgXcQ]Roll[/url] ${eicon('rickroll')}`)
        return
    }

    dice = dice.replace(/\s/g, '')

    let count = 1
    let sides
    let modifier = 0
    let modifierStr = ''
    if (dice.includes('d')) {
        let [prefix, suffix] = dice.split('d')
        count = parseInt(prefix, 10)
        if (suffix.includes('+')) {
            sides = parseInt(suffix.split('+')[0], 10)
            modifier += parseInt(suffix.split('+')[1], 10)
            modifierStr = `+${modifier}`
        } else if (suffix.includes('-')) {
            sides = parseInt(suffix.split('-')[0], 10)
            modifier -= parseInt(suffix.split('-')[1], 10)
            modifierStr = `${modifier}`
        } else {
            sides = parseInt(suffix, 10)
        }
    } else {
        sides = parseInt(dice, 10)
    }


    if (isNaN(count) || isNaN(sides) || isNaN(modifier) || count <= 0 || sides <= 0) {
        sendMSG(channel, 'What?')
    } else if (count > 25) {
        sendMSG(channel, "That's too many dice. No.")
    } else {
        let result
        if (count === 1) {
            result = randomNumber(sides) + modifier
        } else {
            const rolls = []
            for (let i = 0; i < count; i++) {
                rolls.push(randomNumber(sides))
            }
            result = `${rolls.join(' ')} ${modifierStr ? '(' + modifierStr + ') ' : ''}= ${rolls.reduce((a, b) => a + b, 0) + modifier}`
        }

        sendMSG(channel, `${wrapInUserTags(character)} rolls ${count}d${sides}${modifierStr}: ${boldText(result)}`)
    }
}

function performDeathRoll(dice, character, channel) {
    const result = randomNumber(dice)
    if (result === 1) {
        delete deathRollTracker[channel]
        sendMSG(channel, `DEATH ROLL: ${wrapInUserTags(character)} rolls vs ${dice}: ${boldText(1)}! ${eicon(dice > 10 ? 'nuke' : 'blobcatbongoping')}`)
    } else {
        deathRollTracker[channel] = result
        sendMSG(channel, `DEATH ROLL: ${wrapInUserTags(character)} rolls vs ${dice}: ${boldText(result)}!${result === 69 ? ` ${boldText('Nice.')}` : ''}`)
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

function getDisgaeaName(dclass) {
    const disgaeaNames = require("./disgaea-names");
    return boldText(dclass.uniqueNames ? getRandom(dclass.uniqueNames) : getRandom(disgaeaNames))
}

function disgaeaQuest(channel) {
    const disgaea = require("./disgaea");
    const questgiverClass = getRandom(disgaea.classes.filter(c => !c.enemy))
    const targetClass = getRandom(disgaea.classes.filter(c => !c.ally))
    const targetName = `${getDisgaeaName(targetClass)} the ${boldText(targetClass.class)}`
    const weaponTypes = ['axe', 'sword', 'gun', 'spear', 'staff', 'bow', 'glove']
    const location = getRandom(disgaea.locations)
    const quest = getRandom([
        ...questgiverClass.quests,
        `I lost my favorite ${getRandom(weaponTypes)} at ${location}. Get it back!`,
        `${targetName} stole my dessert! Make them pay!`,
        `Help me get to ${location}! I need to stop ${targetName}!`,
        `${targetName} insulted me. I won't stand for it! Grind them into dust!`,
        `I heard the notorious criminal, ${targetName}, was hiding at ${location}.`,
        `Protect me from ${targetName}! I'm begging you!`,
        `I just got this shiny new ${getRandom(weaponTypes)} from the RosenQueen store! Can you please take it to the Item World and level it up?`,
        `I need a courier, urgently! Deliver this package to ${targetName} at ${location}!`,
        `Help, my pet ${targetClass.class} is stuck in a tree!`,
        `Some vandals have placed geo panels in ${location}, blocking up road construction. Please remove them!`,
        `Nothing drives down housing prices like a good old fashioned nether war, except of course a biblical plague. Anyway please go to ${location} and start some trouble.`,
        `The stars are right! The time of my ascension is now at hand! I need you to go to ${location} and perform the nescessary rites. Then you shall be rewarded.`,
        `I'm here to inform you that the Assembly is looking for some temp hires. Please go to ${location} and survey the area.`,
        `Hey there, cutie! Looking for a good time? I'm hosting a blind date to all you cuties and studs out there at ${location}, make sure you're dressed for a wild party~♥`,
        `Help! The Innocents have escaped the innocent farm! They were last seen in ${location}. Please make sure they're not hurt!`,
        `A fashion emergency is underway! Baggy pants, dull suits, and sightings of sandals with socks! I'm deputizing whoever is receiving this message. Go to ${location} and get a delivery of fashionable clothes, and then distribute them to the population of ${getRandom(disgaea.locations)} whether they like it or not!`
    ])
    sendMSG(channel, `${boldText(color('A quest on the board reads:', 'yellow'))}
        ${quest}
            -- ${getDisgaeaName(questgiverClass)} the ${boldText(questgiverClass.class)}`
    )
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
    fchat.send('STA', {
        status: 'online',
        statusmsg: `For a list of commands, use ${boldText('!info')}\n` + 
        `This bot restarts every 24 hours due to Heroku worker limitations. Last restart: ${startDate.toUTCString()}.\n` +
        `Questions or concerns, please contact ${wrapInUserTags('Mitena Twoheart')} or ${wrapInUserTags('Jingly Isabelle')}.\n`
    })
    const channels = await Channel.query().update({pending: true}).returning('*')
    for (const channel of channels) {
        fchat.send('JCH', {channel: channel.id})
    }
    setTimeout(removeDeadChannels, 15 * 60 * 1000)
})

fchat.on("JCH", async ({ channel, character, title }) => {
    if (character.identity === 'Game Bot') {
        console.log('Joined channel', title)
        const existing = await Channel.query().findById(channel).update({pending: false})
        if (!existing) {
            await Channel.query().insert({id: channel, title})
        }
    }
})

fchat.on("ICH", async({ users, channel }) => {
    if (users.length <= 3) {
        const channelData = await Channel.query().findById(channel)
        console.log(`Joined channel with ${users.length} characters: ${channelData?.title} - ${channel}`)
    }
})

fchat.on("LCH", async ({ channel, character }) => {
    await removePlayer(character, channel, true)
    if (character === 'Game Bot') {
        const channels = await Channel.query().where('id', channel)
        if (channels.length) {
            await leaveChannels(channels)
        }
    }
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
const randomItemCommands = ['!food', '!berry', '!drink', '!potion', '!costume', '!minion', '!weapon', '!toy', '!bondage', '!misc']
const randomEffectCommands = ['!curse']
const todRuleCommands = ['!tod help', '!tod help', '!rulestod', '!rules tod', '!todrules', '!tod rules', '!help tod']
const drRuleCommands = ['!dr help', '!drhelp', '!rulesdr', '!drrules', '!rules dr', '!dr rules', '!help dr']
const coinCommands = ['!coin', '!flip', '!coinflip', '!flipcoin']

const teapot = `/me beeps, then spins around in a circle before singing in a tinny, robotic voice. "I'm a little teabot, short and stout. Here is my input, here is my out. When I get all booted up, hear my sound. ERR 404 - LYRIC NOT FOUND."`

const helpText = `List of available commands: [spoiler]
        ${formatCommands(joinCommands)}: Join a game
        ${formatCommands(leaveCommands)}: Leave a game
        ${formatCommands(statusCommands)}: Check current players
        ${formatCommands(['!kick <name>'])}: Kick a player from a game (Not case sensitive, but must be full name)
        ${formatCommands(bottleSpinCommands)}: Spin the bottle
        ${formatCommands(spinbackCommands)}: Toggle spinback prevention
        ${formatCommands(coinCommands)}: Flip a coin
        ${formatCommands(['!roll #', '!roll #d#'])}: Roll dice
        ${formatCommands(['!dr #', '!dr'])}: Start or continue a Death Roll
        ${formatCommands(['!8ball', '!8ball <question>'])}: Seek answers from a higher power
        ${formatCommands(['!twister'])}: Use a Twister spinner (Right Foot Blue!)
        ${formatCommands(randomItemCommands)}: Produce a random item from the given category
        ${formatCommands(['!random'])}: Produce a random item from any of the above categories
        ${formatCommands(randomEffectCommands)}: Inflict a random curse
        ${formatCommands(['!pokemon'])}: Get a random pokemon (Includes gender and form suggestions)
        ${formatCommands(['!beef'])}: Generate a beefy name ([url=https://www.youtube.com/watch?v=RFHlJ2voJHY]Big McLargehuge![/url])
        ${formatCommands(['!leve'])}: Get a random leve (FFXIV quest)
        ${formatCommands(['!dquest'])}: Get a random Disgaea quest
        ${formatCommands(todRuleCommands)}: Show rules for Truth or Dare
        ${formatCommands(drRuleCommands)}: Show rules for Death Roll
        ${formatCommands(helpCommands)}: Show this message [/spoiler]`
const todRules = `Truth or Dare Rules (And suggestions): [spoiler]
        A game requires a minimum of 3 players. If spinback prevention is turned on, this is raised to 4.
        Spinback prevention means that the bottle will not land on the person who spun it last, so the game can't just go back and forth between two players.
        Be respectful of players' orientations, kinks, and room rules. Generally speaking, dares should not include extreme/gross kinks.
        If a player does not respond within 5 minutes, it is okay to skip them and spin again to keep the game moving.
        In order to keep the game going smoothly and lessen the downtime between spins, it can be helpful to spin the bottle after being told your dare, but before you actually perform it. This gives time for the next player to decide whether to do a Truth or Dare while you are still working on writing out your own actions.[/spoiler]`
const drRules = `Death Roll Rules (And suggestions): [spoiler]
        A Death Roll can be performed between two or more players.
        Only one Death Roll can be in progress at a time in a channel.
        Usually there are stakes laid out before the rolling begins - a bet between the players that can be nearly anything.
        Commonly, this is simply an order that the winner will give to the loser that they must obey, though the specific order isn't known until after the rolling ends.
        The starting player chooses a number to begin (2-1000) and uses the command ${boldText('!dr 314')} for instance.
        Players then take turns using ${boldText('!dr')} to keep rolling against the previous number rolled.
        The numbers will gradually go down until a player eventually rolls a ${boldText('1')}. That player loses![/spoiler]`

const badBotRegex = new RegExp(/\bbad bot\b/, 'i')
const goodBotRegex = new RegExp(/\bgood bot\b/, 'i')

fchat.on("MSG", async ({ character, message, channel }) => {
    const xmessage = message.toLowerCase().trim()
    if (xmessage.includes('hey game bot')) {
        sendMSG(channel, `Hey yourself, ${wrapInUserTags(character)}!`)
    } else if (joinCommands.includes(xmessage)) {
        await addPlayer(character, channel)
    } else if (leaveCommands.includes(xmessage)) {
        await removePlayer(character, channel)
    } else if (xmessage.startsWith('!kick ')) {
        const name = xmessage.substr(6)
        await removePlayer(name, channel, false, true)
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
    } else if (xmessage === '!random') {
        sendMSG(channel, `/me produces a ${boldText(color(getRandomItem(getRandom(randomItemCommands)), 'blue'))}!`)
    } else if (randomEffectCommands.includes(xmessage)) {
        const effect = getRandomItem(xmessage)
        sendMSG(channel, `/me calls forth a ${boldText(color(capitalize(xmessage.substr(1)) + ' of ' + effect.effect, effect.color))}! ${boldText(color(effect.description, 'white'))}`)
    } else if (xmessage === '!pokemon') {
        getPokemon(channel, character)
    } else if (xmessage === '!twister') {
        twister(channel)
    } else if (xmessage.startsWith("!8ball")) {
        const result = getRandomItem('8ball')
        sendMSG(channel, `Magic 8 Ball says: ${boldText(color(result.text, result.color))}`)
    } else if (xmessage.startsWith('!roll')) {
        const dice = xmessage.substr(5)
        rollDice(dice, character, channel)
    } else if (todRuleCommands.includes(xmessage)) {
        sendMSG(channel, todRules)
    } else if (drRuleCommands.includes(xmessage)) {
        sendMSG(channel, drRules)
    } else if (helpCommands.includes(xmessage)) {
        sendMSG(channel, helpText)
    } else if (xmessage === '!leve') {
        const leveType = getRandom(['escort', 'hunt', 'eliminate'])
        if (leveType === 'hunt') {
            sendMSG(channel, color(`Hunt down and harvest the required materials from ${boldText(randomNumber(12) + ' ' +getRandomItem('enemy'))} for the ${getRandomItem('race')} ${getRandomItem('occupation')} who needs them.`, 'yellow'))
        } else if (leveType === 'eliminate') {
            sendMSG(channel, color(`Eliminate ${boldText(randomNumber(12) + ' ' + getRandomItem('enemy'))} for the ${getRandomItem('race')} ${getRandomItem('occupation')} who is being ${getRandom(['threatened', 'harassed', 'mildly inconvenienced'])} by them.`, 'yellow'))
        } else if (leveType === 'escort') {
            sendMSG(channel, color(`Escort the ${getRandomItem('race')} ${getRandomItem('occupation')} to ${getRandomItem('location')}.`, 'yellow'))
        }
    } else if (xmessage === '!beef') {
        sendMSG(channel, boldText(color(`${getRandomItem('beef1')} ${getRandomItem('beef2')}${getRandomItem('beef3')}!`, 'yellow')))
    } else if (xmessage === '!curses') {
        sendMSG(channel, getRandomItem('!curses'))
    } else if (xmessage === '!mist') {
        sendMSG(channel, getRandom(['Fog', 'Haze', 'Steam', 'Vapor', 'Cloud']) + '! ... You probably meant !misc, but you can try again.')
    } else if (xmessage.startsWith('!dr')) {
        deathRoll(xmessage, character, channel)
    } else if (xmessage === '!418') {
        sendMSG(channel, teapot)
    } else if (xmessage === '!dquest') {
        disgaeaQuest(channel)
    } else if (badBotRegex.test(xmessage) || goodBotRegex.test(xmessage)) {
        sendMSG(channel, `/me is a ${boldText('very good')} bot.`)
    } else if (character === 'Athena Esparza') {
        const triggers = [
            eicon('dognoise'),
            eicon('athenascream'),
            eicon('athenascreaming'),
            'wail',
            'wailing',
            'scream',
            'screaming'
        ]
        if (triggers.find(tr => xmessage.endsWith(tr))) {
            const result = randomNumber(100)
            if (result > 20) {
                sendMSG(channel, getRandomItem('athena'))
            } else if (result === 1) {
                sendMSG(channel, '/me attempts to put a muzzle on Athena.')
            }
        }
    }
})

fchat.on('PRI', async ({ character, message }) => {
    const xmessage = message.toLowerCase()
    if (todRuleCommands.includes(xmessage)) {
        sendPRI(character, todRules)
    } else if (drRuleCommands.includes(xmessage)) {
        sendPRI(character, drRules)
    } else if (helpCommands.includes(xmessage)) {
        sendPRI(character, helpText)
    } else {
        const admins = (await Admin.query()).map(a => a.name)
        if (admins.includes(character)) {
            if (message.startsWith('!announce')) {
                const announcement = message.substr(10)
                const channels = await Channel.query()
                for (const channel of channels) {
                    sendMSG(channel.id, boldText('Announcement: ') + announcement)
                }
            } else if (message.startsWith('!channels')) {
                const channels = await Channel.query()
                sendPRI(character, `Channel count: ${channels.length}\n` + channels.map(c => `[session]${c.id}[/session] - ${c.id}`).join('\n'))
            } else if (message.startsWith('!leave')) {
                const channel_id = message.substr(7)
                const channel = await Channel.query().findById(channel_id)
                if (channel) {
                    messageQueue.push({ code: 'LCH', payload: { channel: channel_id } })
                    sendPRI(character, `Left channel ${channel.title} ${channel_id} [session]${channel_id}[/session]`)
                } else {
                    sendPRI(character, `Did not find a channel with ID ${channel_id}`)
                }
            } else if (message.includes('|')) {
                let [channel, command] = message.split('|')
                sendMSG(channel, command)
            } else if (message === '!update') {
                const channels = await Channel.query()
                for (const channel of channels) {
                    sendMSG(channel.id, boldText(color('Alert: Incoming update. System will restart soon. Any in-progress Death Rolls will be lost. Truth or Dare games are safe. Restart should take less than five minutes.', 'red')))
                }
            }
        } else {
            sendPRI(character, "Only help commands are valid in private messages. If you would like to access other commands, they must be used in a room.")
        }
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
}, 2 * 60 * 1000);

setInterval(function send() {
    const msg = messageQueue.shift(1)
    if (msg) {
        fchat.send(msg.code, msg.payload)
    }
}, 1001)

connect()