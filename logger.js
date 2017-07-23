let winston = require('winston')
let WinstonDaily = require('winston-daily-rotate-file')
let fs = require('fs')

let env = process.env.NODE_ENV || 'development'
let logDir = `${__dirname}/log`

if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir)
}

let tsFormat = () => (new Date().toLocaleTimeString())
let logger = new (winston.Logger)({
	transports: [
		new (winston.transports.Console)({
			timestamp: tsFormat,
			colorize: true,
			level: 'silly'
		}),
		new WinstonDaily({
			filename: `${logDir}/-results.log`,
			timestamp: tsFormat,
			datePattern: 'yyyy-MM-dd',
			prepend: true,
			level: env === 'development' ? 'silly' : 'info',
			handleExceptions: true
		})
	],
	exitOnError: false
})

module.exports = logger
