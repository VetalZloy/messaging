let logger = require('./logger')

let fs = require('fs')
let env = process.env.NODE_ENV || 'default'

logger.info(`Environment is '${env}'`)
var cfg = JSON.parse(fs.readFileSync(`./${env}.json`, 'utf8'))

module.exports = cfg
