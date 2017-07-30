let cfg = require('./config/config')
let logger = require('./logger')
let authService = require('./auth/authService')
let dialogService = require('./dialog/dialogService')
let chatService = require('./chat/chatService')

let app = require('express')()
let bodyParser = require('body-parser')
var expressCookieParser = require('cookie-parser')

let socketIO = require('socket.io')
let ioCookieParser = require('socket.io-cookie')

let io

app.use(expressCookieParser())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
	'extended': true
}))

var server = app.listen(cfg.port, function () {
	logger.info(`Listen ${cfg.port}`)
})

io = socketIO(server)
io.use(ioCookieParser)

authService(app)
dialogService(app, io)
chatService(app, io)
