let logger = require('../logger')

let fs = require('fs')
let env = process.env.NODE_ENV || 'default'

logger.info(`Environment is '${env}'`)

let cfg = JSON.parse(fs.readFileSync(`./config/${env}.json`, 'utf8'))

module.exports = cfg
