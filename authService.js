let cfg = require('./config')
let logger = require('./logger')

let jwt = require('jsonwebtoken')
let bcrypt = require('bcrypt')
let MongoClient = require('mongodb').MongoClient

let db = {}

MongoClient.connect(cfg.mongo.uri, function (err, database) {
	if (err) {
		logger.error('Error happened during creating conection to MongoDB - ', err)
		return
	}
	db.approvedServices = database.collection('approvedServices')
})

module.exports = function (app) {

	/**
	 * Authentificates client and returns JSON WEB token
	 * @param  {Request} req  - HTTP request
	 * @param  {[Response} res) - HTTP response
	 * @return {Void}
	 */
	app.post('/messaging/auth', async function (req, res) {
		try {			
			let name = req.body.name
			let password = req.body.password

			let service = await db.approvedServices.findOne({name: name})
			if (service == null) {
				logger.warn(`User with name '${name}' doesn't exist}`)
				res.status(401).send({
					success: false,
					message: 'Wrong name'
				})
				return
			}

			let validPassword = await bcrypt.compare(password, service.password)
			if (validPassword) {
				let token = await jwt.sign(service, cfg.secret, {expiresIn: 60 * 2})
				logger.info(`AUTHENTICATED: User with name '${name}'`)
				res.json({
					success: true,
					token: token
				})
			} else {
				logger.warn(`User with name '${name}'' provided wrong password`)
				res.status(401).send({
					success: false,
					message: 'Wrong password'
				})
			}
			
		} catch (e) {
			logger.warn('Error happened during authorizing - ', e)
		}
	})
}
