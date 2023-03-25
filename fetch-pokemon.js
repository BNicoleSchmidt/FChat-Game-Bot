const fetch = require("node-fetch")
const fs = require("fs")
const _ = require("lodash")

const pokemon = []

function getForm(longName, name) {
    return longName.replace(name + '-', '')
}

function recursiveFetchPokemon(id) {
    fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}/`)
        .then(res => res.json())
        .then(json => {
            const forms = ['normal', ...json.varieties.filter(v => !v.is_default).map(v => getForm(v.pokemon.name, json.name))]
            pokemon.push({ id, name: json.name, genderRate: json.gender_rate, forms })
            console.log('Fetched', id)
            if (id < 1010) {
                recursiveFetchPokemon(id + 1)
            } else {
                fs.writeFile('pokemon.json', JSON.stringify(_.sortBy(pokemon, 'id'), 0, 4), err => { })
            }
        })
}

recursiveFetchPokemon(1)
