let logger = require('./logger')
let redisSession = require('./redis-session')
let DialogDAO = require('./dialogDAO')

module.exports = function (app, io) {

	let dialogDAO = new DialogDAO()
	let dialogSpace = io.of('/dialog')

	/**
	 * Retreives and put to response list of interlocutors of current user 
	 * and the last messages in dialogs between them
	 * @param  {Request} req - HTTP request
	 * @param  {Response} res - HTTP request
	 * @return {Void}
	 */
	app.get('/messaging/dialogs', async function (req, res) {
		try {
			let userId = await getCurrentUserId(req.cookies)
			logger.debug(`User with id=${userId} requested list of interlocutors`)

			let interlocutors = await dialogDAO.getInterlocutors(userId, createDialogId)
			logger.debug(`List of interlocutors for user with id=${userId} was extracted. Size: ${interlocutors.length}`)

			res.status(200).send({interlocutors: interlocutors})
		} catch (e) {
			logger.warn('Error happened during retreiving interlocutors - ', e)
			res.status(500).send({ error: e.message })
		}
	})

	/**
	 * Counts amount of unread messages for current user and put it to response
	 * @param  {Request} req - HTTP request
	 * @param  {Response} res - HTTP response
	 * @return {Void}
	 */
	app.get('/messaging/dialogs/unread-messages', async function (req, res) {
		try {
			let userId = await getCurrentUserId(req.cookies)
			let amount = await dialogDAO.unreadMessagesAmount(userId, createDialogId)

			res.status(200).send({ unreadMessagesAmount: amount })
		} catch (e) {
			logger.warn('Error happened during counting unread messages - ', e)
			res.status(500).send({ error: e.message })
		}
	})

	/**
	 * Resolves dialog, puts IDs of current user and interlocutor to socket Object
	 * @param  {Socket} socket - web socket which will be putted with IDs
	 * @param  {Function} next - function to optionally defer execution to the next registered middleware
	 * @return {Void}
	 */
	dialogSpace.use(async function (socket, next) {
		try {
			socket.userId = await getCurrentUserId(socket.request.headers.cookie)
			socket.interlocutorId = parseInt(socket.handshake.query.interlocutorId)

			logger.info(`OPENED socket for dialog between users ${socket.userId} and ${socket.interlocutorId}`)

			next()
		} catch (e) {
			logger.warn('Error happened during resolving dialog - ', e)
			next(e)
		}
	})

	dialogSpace.on('connection', async function (socket) {
		let dialogId = createDialogId(socket.userId, socket.interlocutorId)
		socket.join(dialogId)

		try {
			await dialogDAO.upsertInterlocutorId(socket.userId, socket.interlocutorId)
			await dialogDAO.upsertInterlocutorId(socket.interlocutorId, socket.userId)
			let lastMessages = await dialogDAO.getLastMessagesInDialog(dialogId)
			logger.debug(`Messages for dialog '${dialogId}' were extracted. Amount = ${lastMessages.length}; userId = ${socket.userId}`)

			if (lastMessages.length > 0) {
				lastMessages.forEach(m => delete m.dialogId)
				if (lastMessages[0].read === false && 
					lastMessages[0].senderId !== socket.userId) {
					lastMessages[0].read = true
					await dialogDAO.putRead(lastMessages[0]._id)
				}
			}
			socket.emit('messages', lastMessages)
		} catch (e) {
			logger.warn(`Error happened during sending last messages to user with ID = ${socket.userId} - `, e)
			socket.emit('error', e)
		}

		socket.on('disconnect', function () {
			logger.info(`CLOSED socket for dialog between users ${socket.userId} and ${socket.interlocutorId}`)
		})

		/**
		 * Creates new messages, saves it to database and sends to clients
		 * @param  {JSON} data) - JSON which consists text of new message
		 * @return {Void}
		 */
		socket.on('create_message', async function (data) {
			let read = false
			if (uniqueUsersAmount(dialogId) === 2) // both interlocutors in room
				read = true			

			try {
				let message = await dialogDAO.createMessage(dialogId, socket.userId, data.text, read)
				logger.silly(`Message from ${socket.userId} to ${socket.interlocutorId} were created`)

				dialogSpace.to(dialogId).emit('messages', [message])
			} catch (e) {
				logger.warn(`Error happened during creating mesage from='${socket.userId}' to='${socket.interlocutorId}' - `, e)
				socket.emit('error', e)
			}
		})

		/**
		 * Retrieves messages which were created before some message
		 * @param  {JSON} data) - JSON which consists earliestId - ID of earliest message possesed by client
		 * @return {Void}
		 */
		socket.on('get_previous', async function (data) {
			logger.debug(`User with ID=${socket.userId} requested for messages before ${data.earliestId}`)
			try {
				let previousMessages = await dialogDAO.getPreviousMessages(dialogId, data.earliestId)
				previousMessages.forEach(m => delete m.dialogId)
				logger.debug(`Messages before ${data.earliestId} were extracted. Amount = ${previousMessages.length}; userID = ${socket.userId}`)

				socket.emit('previous', previousMessages)
			} catch (e) {
				logger.warn(`Error happened during getting messages before message with ID='${data.earliestId}' - `, e)
				socket.emit('error', e)
			}
		})
	})

	/**
	 * Creates dialog ID by IDs of interlocutors
	 * @param  {int} id1 - ID of first interlocutor
	 * @param  {int} id2 - ID of first interlocutor
	 * @return {String} - created dialog ID
	 */
	function createDialogId (id1, id2) {
		if (id1 < id2)
			return id1 + '-' + id2
		else
			return id2 + '-' + id1
	}

	/**
	 * Counts amount of unique interlocutors in room
	 * @param  {String} dialogId - name of room
	 * @return {int} - amount of unique interlocutors in room
	 */
	function uniqueUsersAmount (dialogId) {
		try {
			let ids = []
			let socketObj = dialogSpace.adapter.rooms[dialogId].sockets
			Object.keys(socketObj)
				  .forEach(socId => ids.push(dialogSpace.connected[socId].userId))
			return new Set(ids).size
		} catch (e) {
			logger.warn(`Error happened during counting unique users amount in room with ID='${dialogId}' - `, e)
		}
	}

	/**
	 * Retreives ID of current user
	 * @param  {[Cookie]} cookies - HTTP cookies
	 * @return {int} - ID of current user
	 */
	async function getCurrentUserId (cookies) {
		let stringUserId = await redisSession(cookies.SESSION)
		return stringUserId
	}
}
