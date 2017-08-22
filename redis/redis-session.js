let cfg = require('../config/config')

let redisClient = require('redis').createClient(cfg.redis.uri)
let asyncRedisClient = require('async-redis').decorate(redisClient)

/**
 * Retrieves ID of current user
 * @param  {String} session - string which specifices some user
 * @return {int}         [description]
 */
async function getIdBySession (session) {
	let object = await asyncRedisClient.hget(`spring:session:sessions:${session}`, 'sessionAttr:id')
	
	/*
	Due to strange format of Spring Session attributes in Redis, I added '|BEGIN|' to each attribute
	to separate Spring Session data and my one
	 */
	if (object == null || object.split('|BEGIN|').length < 2)
		throw new Error(`Wrong session: ${session}`)

	let stringId = object.split('|BEGIN|')[1]
	return parseInt(stringId)
}

module.exports = getIdBySession
