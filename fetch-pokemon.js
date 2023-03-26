const fetch = require("node-fetch")
const fs = require("fs")
const _ = require("lodash")

const pokemon = []

function getForm(longName, name) {
    const form = longName.replace(name + '-', '')
    return form === name ? 'normal' : form.replace('-', ' ').replace('gmax', 'gigantamax').replace('alola', 'alolan').replace('galar', 'galarian')
}

function recursiveFetchPokemon(id) {
    fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}/`)
        .then(res => res.json())
        .then(json => {
            const name = json.name
            const forms = json.varieties.map(v => getForm(v.pokemon.name, name)).filter(f => !['male', 'female'].includes(f))
            if (forms.length === 0) {
                forms.push('normal')
            }
            pokemon.push({ id, name, genderRate: json.gender_rate, forms })
            console.log('Fetched', id)
            if (id < 1010) {
                recursiveFetchPokemon(id + 1)
            } else {
                fs.writeFile('pokemon.json', JSON.stringify(_.sortBy(pokemon, 'id'), 0, 4), err => { })
            }
        })
}

recursiveFetchPokemon(1)
