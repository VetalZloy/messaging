let cfg = require('../config/config')
let logger = require('../logger')
let ChatDAO = require('./chatDAO')
let redisSession = require('../redis/redis-session')

let chatRouter = require('express').Router()
let jwt = require('jsonwebtoken')

module.exports = function (app, io) {

	let chatDAO = new ChatDAO()
	let chatSpace = io.of('/chat')

	/**
	 * Retrieves chats for current user
	 * @param  {Request} req - HTTP request
	 * @param  {Response} res - HTTP response
	 * @return {Void}
	 */
	chatRouter.get('/', async function (req, res) {
		try {
			let userId = await getCurrentUserId(req.cookies)
			logger.debug(`User with id=${userId} requested list of chats`)

			let chats = await chatDAO.getChats(userId)
			logger.debug(`List of chats for user with id=${userId} was extracted. Size: ${chats.length}`)

			res.status(200).send({chats: chats})
		} catch (e) {
			logger.warn('Error happened during retreiving chats - ', e)
			res.status(500).send({ error: e.message })
		}
	})

	/**
	 * Counts amount of unread chat messages for current user
	 * @param  {Request} req - HTTP request
	 * @param  {Response} res - HTTP response
	 * @return {Void}
	 */
	chatRouter.get('/unread-messages', async function (req, res) {
		try {
			let userId = await getCurrentUserId(req.cookies)
			let amount = await chatDAO.unreadMessagesAmount(userId)

			res.status(200).send({ unreadMessagesAmount: amount })
		} catch (e) {
			logger.warn('Error happened during counting unread messages - ', e)
			res.status(500).send({ error: e.message })
		}
	})

	/**
	 * Verifies whether current user authenticated
	 * @param  {Request} req - HTTP request
	 * @param  {Response} res - HTTP response
	 * @param  {Function} next - next link in chain of handlers 
	 * @return {Void}
	 */
	chatRouter.use(async function (req, res, next) {
		var token = req.body.token || req.headers['x-access-token']

		if (token) {			
			try {
				let service = await jwt.verify(token, cfg.secret)
				req.service = service
				next()
			} catch (e) {
				if (e.name === 'TokenExpiredError') {
					logger.warn('Expired token')
					return res.status(401).send({ 
						success: false, 
						message: 'Token expired' 
					})
				} 
				logger.warn('Error happened during checking authentication - ', e)
				res.status(500).send({ 
					success: false, 
					message: 'Failed to authenticate token' 
				})
			}
		} else {
			res.status(403).send({ 
				success: false, 
				message: 'No token provided'
			})			
		}
	})

	/**
	 * Adds users to chat
	 * @param  {Request} req - HTTP request
	 * @param  {Response} res - HTTP response
	 * @return {Void}
	 */
	chatRouter.put('/:id', async function (req, res) {
		let chatId = parseInt(req.params.id)
		let body = req.body
		if (body.usersToAdd) {
			try {
				await chatDAO.addUsers(chatId, body.usersToAdd)
				logger.info(`Users were added to chat ${chatId}`)
			} catch (e) {
				logger.warn(`Error happened during adding users to chat with ID = ${chatId}`, e)
				res.status(500)
			}
		}
		if (body.usersToRemove) {
			try {
				await chatDAO.removeUsers(chatId, body.usersToRemove)
				logger.info(`Users were removed from chat ${chatId}`)
			} catch (e) {
				logger.warn(`Error happened during removing users from chat with ID = ${chatId}`, e)
				res.status(500)
			}
		}
		
		res.status(200).json({success: true})
	})

	app.use('/messaging/chats', chatRouter)

	/**
	 * Checks whether current user can write in this chat
	 * @param  {Socket} socket - socket of current user
	 * @param  {Function} next - next link in chain of handlers 
	 * @return {Void}
	 */
	chatSpace.use(async function (socket, next) {
		try {
			socket.userId = await getCurrentUserId(socket.request.headers.cookie)
			socket.chatId = parseInt(socket.handshake.query.chatId)

			let usersInChat = await chatDAO.getUsersInChat(socket.chatId)
			if (usersInChat.lastIndexOf(socket.userId) === -1) {
				logger.warn(`User ${socket.userId} tried to access chat ${socket.chatId}`)
				next(new Error('Access denied'))
			} else
				logger.info(`OPENED chat socket for user ${socket.userId} in chat ${socket.chatId}`)

			next()
		} catch (e) {
			logger.warn('Error happened during resolving dialog - ', e)
			next(e)
		}
	})

	chatSpace.on('connection', async function (socket) {
		socket.join(socket.chatId)
		chatSpace.to(socket.chatId).emit('users', getUsersInRoom(socket.chatId))

		try {
			let lastMessages = await chatDAO.getLastMessagesInChat(socket.chatId, socket.userId)
			logger.debug(`Messages for chat '${socket.chatId}' were extracted. Amount = ${lastMessages.length}; userId = ${socket.userId}`)

			if (lastMessages.length > 0) {
				if (lastMessages[0].read === false) {
					lastMessages[0].read = true
					await chatDAO.putRead(lastMessages[0]._id)
				}
			}
			chatSpace.to(socket.chatId).emit('messages', lastMessages)			
		} catch (e) {
			logger.warn(`Error happened during retreiving last messages for user ${socket.userId} in chat ${socket.chatId} - `, e)
		}

		/**
		 * Sends updated list of users in chat room after current user disconnects
		 * @return {Void}
		 */
		socket.on('disconnect', function () {
			logger.info(`CLOSED chat socket for user ${socket.userId} in chat ${socket.chatId}`)
			chatSpace.to(socket.chatId).emit('users', getUsersInRoom(socket.chatId))
		})

		/**
		 * Creates message in db and sends it to all users in chat room
		 * @param  {JSON} data - object, which consist data for message
		 * @return {Void}
		 */
		socket.on('create_message', async function (data) {
			try {
				let usersInChat = await chatDAO.getUsersInChat(socket.chatId)
				let usersInRoom = getUsersInRoom(socket.chatId)

				let messagePromises = []
				let date = new Date()
				for (let recipientId of usersInChat) {
					let message = {
						recipientId: recipientId,
						chatId: socket.chatId,
						senderId: socket.userId,
						text: data.text,
						date: date,
						read: usersInRoom.lastIndexOf(recipientId) !== -1
					}

					let promise = chatDAO.saveMessage(message)
					messagePromises.push(promise)
				}

				try {
					await Promise.all(messagePromises)
				} catch (e) {
					logger.warn('Error happened during creating message - ', e)
				}

				let commonMessage = {
					chatId: socket.chatId,
					senderId: socket.userId,
					text: data.text,
					date: date
				}
				chatSpace.to(socket.chatId).emit('messages', [commonMessage])
			} catch (e) {
				logger.warn(`Error happened during creating message - `, e)
			}
			
		})

		/**
		 * Retrieves messages before some message
		 * @param  {JSON} data - object, which consists ID of last message possessed by user
		 * @return {Void}
		 */
		socket.on('get_previous', async function (data) {
			logger.debug(`User with ID=${socket.userId} requested for messages before ${data.earliestId}`)
			try {
				let previousMessages = await chatDAO.getPreviousMessages(socket.chatId, socket.userId, data.earliestId)
				logger.debug(`Messages before ${data.earliestId} were extracted. Amount = ${previousMessages.length}; userID = ${socket.userId}`)

				socket.emit('previous', previousMessages)
			} catch (e) {
				logger.warn(`Error happened during getting messages before message with ID='${data.earliestId}' - `, e)
				socket.emit('error', e)
			}
		})
	})

	/**
	 * Retreives ID of current user
	 * @param  {[Cookie]} cookies - HTTP cookies
	 * @return {Integer} - ID of current user
	 */
	async function getCurrentUserId (cookies) {
		let stringUserId = await redisSession(cookies.SESSION)
		return stringUserId
	}

	/**
	 * Retrieves list of IDs of users, which are in chat room now
	 * @param  {[type]} chatId [description]
	 * @return {[type]}        [description]
	 */
	function getUsersInRoom (chatId) {
		try {
			let ids = []
			let socketObj = chatSpace.adapter.rooms[chatId].sockets
			Object.keys(socketObj)
				  .forEach(socId => ids.push(chatSpace.connected[socId].userId))
			return Array.from(new Set(ids))
		} catch (e) {
			logger.warn(`Error happened during retrieving users in chat ${chatId} - `, e)
		}
	}

}
