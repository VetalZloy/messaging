let cfg = require('./config')
let logger = require('./logger')

let MongoClient = require('mongodb').MongoClient
let ObjectID = require('mongodb').ObjectID
let db = {}

/**
 * Puts Collection objects to 'db' object to make all queries to Mongo CLI-like (very cool)
 * @param {Void}
 */
function ChatDAO () {
	MongoClient.connect(cfg.mongo.uri, function (err, database) {
		if (err) {
			logger.error('Error happened during creating conection to MongoDB - ', err)
			return
		}
		db.chatMessages = database.collection('chatMessages')
		db.chats = database.collection('chats')
	})
}

/**
 * Retrieves last message IDs for each chat for necessary user
 * @param  {Integer} userId - ID of user
 * @return {[Integer]} - array of IDs of last messages
 */
async function getLastMessageIds (userId) {
	let chats = await db.chats.find({users: userId}).toArray()
	let chatIds = chats.map(c => c.id)
	let chatToLastMessageIdString = await db.chatMessages.aggregate([
		{$match: {
			recipientId: userId,
			chatId: {$in: chatIds}}},
		{
			$group: {
				_id: '$chatId',
				lastMessageId: {$max: '$_id'}
			}
		}
	]).toArray()
	let lastMessageIDs = chatToLastMessageIdString.map(o => new ObjectID(o.lastMessageId))
	return lastMessageIDs
}

/**
 * Adds users into chat
 * @param  {Integer} id - chat ID
 * @param  {[Integer]} users - array of users' IDs
 * @return {Void}
 */
ChatDAO.prototype.addUsers = async function (id, users) {
	await db.chats.update(
		{id: id}, 
		{$addToSet: {users: {$each: users}}}, 
		{upsert: true}
	)
}

/**
 * Removes users from chat
 * @param  {Integer} id - chat ID
 * @param  {[Integer]} users - array of users' IDs
 * @return {Void}
 */
ChatDAO.prototype.removeUsers = async function (id, users) {
	await db.chats.update(
		{id: id}, 
		{$pullAll: {users: users}}
	)
}

/**
 * Retreives list of users in chat
 * @param  {Integer} id - chat ID
 * @return {[Integer]} - array of users' IDs
 */
ChatDAO.prototype.getUsersInChat = async function (id) {
	let chat = await db.chats.findOne({id: id})
	return chat.users
}

/**
 * Saves chat messages
 * @param  {JSON} message - JSON object, which represents message in db
 * @return {Void}
 */
ChatDAO.prototype.saveMessage = async function (message) {
	await db.chatMessages.insert(message)
}

/**
 * Retreives last messages from necessary chat
 * @param  {Integer} chatId - chat ID
 * @param  {Integer} userId - ID of current user
 * @return {[JSON]} - array of objects, which represent messages in db
 */
ChatDAO.prototype.getLastMessagesInChat = async function (chatId, userId) {
	let lastMessages = await db.chatMessages.find({recipientId: userId, chatId: chatId})
											.sort({date: -1})
											.limit(20)
											.toArray()
	return lastMessages
}

/**
 * Retrieves messages in chat which were created before some message
 * @param  {Integer} chatId - chat ID
 * @param  {Integer} recipientId - ID of current user
 * @param  {String} earliestId - ID of earliest message possesed by client
 * @return {[JSON]} - array of objects, which represent messages in db
 */
ChatDAO.prototype.getPreviousMessages = async function (chatId, recipientId, earliestId) {
	let previousMessages = await db.chatMessages
								   .find({
								   	  recipientId: recipientId,
								   	  chatId: chatId,
								   	  _id: {$lt: new ObjectID(earliestId)}
								   })
								   .sort({date: -1})
								   .limit(20)
								   .toArray()
	return previousMessages
}

/**
 * Counts amount of unread messages for current user
 * @param  {Integer} userId - ID of current user
 * @return {Integer} - amount of unread messages for current user
 */
ChatDAO.prototype.unreadMessagesAmount = async function (userId) {
	let lastMessageIDs = await getLastMessageIds(userId)
	let amount = await db.chatMessages
						 .find({
						 	_id: {$in: lastMessageIDs},
						 	read: false})
						 .count()
	return amount
}

/**
 * Put TRUE to read attribute of some message
 * @param  {ObjectID} _id - id of message will be updated
 * @return {Void}
 */
ChatDAO.prototype.putRead = async function (_id) {
	await db.chatMessages.updateOne(
		{_id: _id}, 
		{$set: {read: true}}
	)
}

/**
 * Retrieves last messages for each chat for current user
 * @param  {Integer} userId - ID of current user
 * @return {[JSON]} - array of objects, which represent messages in db
 */
ChatDAO.prototype.getChats = async function (userId) {	
	let lastMessageIDs = await getLastMessageIds(userId)
	let lastMessages = await db.chatMessages.find({_id: {$in: lastMessageIDs}})
											.toArray()

	lastMessages.sort((m1, m2) => m1.date < m2.date)
	return lastMessages
}

module.exports = ChatDAO
