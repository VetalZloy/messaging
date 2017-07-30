let cfg = require('../config/config')
let logger = require('../logger')

let MongoClient = require('mongodb').MongoClient
let ObjectID = require('mongodb').ObjectID
let db = {}

/**
 * Puts Collection objects to 'db' object to make all queries to Mongo CLI-like (very cool)
 * @param {Void}
 */
function DialogDAO () {
	MongoClient.connect(cfg.mongo.uri, function (err, database) {
		if (err) {
			logger.error('Error happened during creating conection to MongoDB - ', err)
			return
		}
		db.dialogMessages = database.collection('dialogMessages')
		db.dialogs = database.collection('dialogs')
	})
}

/**
 * Retrieves list of IDs last messsages for all interlocutors of current user
 * @param  {int} userId - ID of current user
 * @param  {Function} createDialogId - function which creates dialogId by IDs of interlocutors
 * @return {[String]} - String array of IDs last messsages for all interlocutors of current user
 */
async function getLastMessageIds (userId, createDialogId) {
	let userDialogs = await db.dialogs.findOne({id: userId})
	if (userDialogs == null)
		return []

	let dialogIds = userDialogs.interlocutors.map(interlocutorId => createDialogId(userId, interlocutorId))

	let dialogToLastMessageIdString = await db.dialogMessages.aggregate([
		{$match: {dialogId: {$in: dialogIds}}},
		{
			$group: {
				_id: '$dialogId',
				lastMessageId: {$max: '$_id'}
			}
		}
	]).toArray()
	let lastMessageIds = dialogToLastMessageIdString.map(o => new ObjectID(o.lastMessageId))
	return lastMessageIds
}

/**
 * Retrieves messages in dialog which were created before some message
 * @param  {String} dialogId - ID of dialog for which messages will be extracted
 * @param  {String} earliestId - ID of earliest message possesed by client
 * @return {[JSON]} - array of JSONs which represent messages from Mongo
 */
DialogDAO.prototype.getPreviousMessages = async function (dialogId, earliestId) {
	let previousMessages = await db.dialogMessages
								   .find({
								   	  dialogId: dialogId,
								   	  _id: {$lt: new ObjectID(earliestId)}
								   })
								   .sort({date: -1})
								   .limit(20)
								   .toArray()
	return previousMessages
}

/**
 * Creates and saves message
 * @param  {String} dialogId - ID of dialog for which message will be created
 * @param  {int} senderId - ID of user who sended message will be created
 * @param  {String} text - text of message will be created
 * @param  {boolean} read - attribute which shows whether message was read by consumer(receiver)
 * @return {JSON} - created and saved message
 */
DialogDAO.prototype.createMessage = async function (dialogId, senderId, text, read) {
	let message = {
		dialogId: dialogId,
		senderId: senderId,
		text: text,
		date: new Date(),
		read: read
	}
	await db.dialogMessages.insertOne(message)
	return message
}

/**
 * Put TRUE to read attribute of some message
 * @param  {ObjectID} _id - id of message will be updated
 * @return {Void}
 */
DialogDAO.prototype.putRead = async function (_id) {
	await db.dialogMessages.updateOne(
		{_id: _id}, 
		{$set: {read: true}}
	)
}

/**
 * Adds ID of interlocutor to SET of interlocutors for current user
 * @param  {int} userId - ID of current user
 * @param  {int} interlocutorId - ID of interlocutor will be added to SET
 * @return {Void}
 */
DialogDAO.prototype.upsertInterlocutorId = async function (userId, interlocutorId) {
	await db.dialogs.update(
		{id: userId}, 
		{$addToSet: {interlocutors: interlocutorId}}, 
		{upsert: true}
	)
}

/**
 * Creates list of interlocutors for current user 
 * and list of last messages for each pair between them
 * @param  {int} userId - ID of current user
 * @param  {Function} createDialogId - function which creates dialogId by IDs of interlocutors
 * @return {[JSON]} - array of JSONs
 */
DialogDAO.prototype.getInterlocutors = async function (userId, createDialogId) {
	let lastMessageIds = await getLastMessageIds(userId, createDialogId)

	let interlocutors = []
	let lastMessages = await db.dialogMessages.find({_id: {$in: lastMessageIds}})
											  .toArray()
	lastMessages.forEach(function (mes) {
		let interlocutorId = mes.dialogId
								.split('-')
								.map(id => parseInt(id))
								.filter(id => id !== userId)[0]
		let interlocutor = {
			interlocutorId: interlocutorId,
			senderId: mes.senderId,
			date: mes.date,
			text: mes.text,
			read: mes.read
		}
		interlocutors.push(interlocutor)
	})

	interlocutors.sort((i1, i2) => i1.date < i2.date)
	return interlocutors
}

/**
 * Counts amount of unread messages for current user
 * @param  {int} userId - ID of current user
 * @param  {Function} createDialogId - function which creates dialogId by IDs of interlocutors
 * @return {int} - amount of unread messages for current user
 */
DialogDAO.prototype.unreadMessagesAmount = async function (userId, createDialogId) {
	let lastMessageIds = await getLastMessageIds(userId, createDialogId)
	let amount = await db.dialogMessages
						 .find({
						 	_id: {$in: lastMessageIds},
						 	senderId: {$ne: userId},
						 	read: false})
						 .count()
	return amount
}

/**
 * Retreives last messages from some dialog
 * @param  {String} dialogId - ID of dialog for which messages will be extracted
 * @return {[JSON]} - array of JSONs whicр represent messages
 */
DialogDAO.prototype.getLastMessagesInDialog = async function (dialogId) {
	let lastMessages = await db.dialogMessages.find({dialogId: dialogId})
											  .sort({date: -1})
											  .limit(20)
											  .toArray()
	return lastMessages
}

module.exports = DialogDAO
