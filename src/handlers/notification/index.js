/*****
 License
 --------------
 Copyright © 2017 Bill & Melinda Gates Foundation
 The Mojaloop files are made available by the Bill & Melinda Gates Foundation under the Apache License, Version 2.0 (the "License") and you may not use these files except in compliance with the License. You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, the Mojaloop files are distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 Contributors
 --------------
 This is the official list of the Mojaloop project contributors for this file.
 Names of the original copyright holders (individuals or organizations)
 should be listed with a '*' in the first column. People who have
 contributed from an organization can be listed under the organization
 that actually holds the copyright for their contributions (see the
 Gates Foundation organization for an example). Those individuals should have
 their names indented and be marked with a '-'. Email address can be added
 optionally within square brackets <email>.
 * Gates Foundation
 - Name Surname <name.surname@gatesfoundation.com>
 --------------
 ******/

'use strict'
const Consumer = require('@mojaloop/central-services-shared').Kafka.Consumer
const Logger = require('@mojaloop/central-services-shared').Logger
const Config = require('../../lib/config')
const Utility = require('../../lib/utility')
const Callback = require('./callbacks.js')
const Perf4js = require('@mojaloop/central-services-shared').Perf4js
const NOTIFICATION = 'notification'
const EVENT = 'event'
let notificationConsumer = {}

const startConsumer = async () => {
  var metricStartNow = (new Date()).getTime()
  Logger.info('Notification::startConsumer')
  try {
    let topicName = Utility.getNotificationTopicName()
    Logger.info('Notification::startConsumer::topicName: ' + topicName)
    let config = Utility.getKafkaConfig(Utility.ENUMS.CONSUMER, NOTIFICATION.toUpperCase(), EVENT.toUpperCase())
    config.rdkafkaConf['client.id'] = topicName

    notificationConsumer = new Consumer([topicName], config)
    Logger.info('Notification::startConsumer::Consumer: new')

    await notificationConsumer.connect()
    Logger.info('Kafka Consumer connected')
    await notificationConsumer.consume(consumeMessage)
    Logger.info('Kafka Consumer handler created')
    var metricEndNow = (new Date()).getTime()
    var metricMlAPIStartConsume = metricEndNow - metricStartNow
    Perf4js.info(metricStartNow, metricMlAPIStartConsume, 'metricMlAPIStartConsume')
    return true
  } catch (err) {
    Logger.error(`error consuming kafka messages- ${err}`)
    throw err
  }
}
const consumeMessage = async (error, message) => {
  var metricStartNow = (new Date()).getTime()
  Logger.info('Notification::consumeMessage')
  return new Promise(async (resolve, reject) => {
    if (error) {
      Logger.error(`Error while reading message from kafka ${error}`)
      return reject(error)
    }
    Logger.info(`Notification:consumeMessage message: - ${JSON.stringify(message)}`)

    message = (!Array.isArray(message) ? [message] : message)

    for (let msg of message) {
      var metricStartForNow = (new Date()).getTime()
      Logger.info(`guid=${msg.value.id}:uuid - startNotificationHandler:process`)
      Logger.info('Notification::consumeMessage::processMessage')
      let res = await processMessage(msg).catch(err => {
        Logger.error(`Error processing the kafka message - ${err}`)
        notificationConsumer.commitMessageSync(msg)
        return reject(err)
      })
      notificationConsumer.commitMessageSync(msg)
      Logger.info(`guid=${msg.value.id}:uuid - endNotificationHandler:process`)
      var metricEndForNow = (new Date()).getTime()
      var metricMlAPIConsumeMessageForEachMsg = metricEndForNow - metricStartForNow
      Perf4js.info(msg.value.id, metricMlAPIConsumeMessageForEachMsg, 'metricMlAPIConsumeMessageForEachMsg')
      return resolve(res)
    }
    var metricEndNow = (new Date()).getTime()
    var metricMlAPIConsumeMessage = metricEndNow - metricStartNow
    Perf4js.info(metricStartNow, metricMlAPIConsumeMessage, 'metricMlAPIConsumeMessage')
  })
}

const processMessage = async (msg) => {
  var metricStartNow = (new Date()).getTime()
  try {
    Logger.info('Notification::processMessage')
    if (!msg.value || !msg.value.content || !msg.value.content.headers || !msg.value.content.payload) {
      throw new Error('Invalid message received from kafka')
    }
    const {metadata, from, to, content, id} = msg.value
    const {action, state} = metadata.event
    const status = state.status
    Logger.info('Notification::processMessage action: ' + action)
    Logger.info('Notification::processMessage status: ' + status)
    if (action === 'prepare' && status === 'success') {
      const result = await Callback.sendCallback(Config.DFSP_URLS[to].transfers, 'post', content.headers, content.payload)
      let metricEndNow = (new Date()).getTime()
      let metricMlAPIProcessMessage = metricEndNow - metricStartNow
      Perf4js.info(msg.value.id, metricMlAPIProcessMessage, 'metricMlAPIProcessMessage')
      return result
    } else if (action.toLowerCase() === 'prepare' && status.toLowerCase() !== 'success') {
      const result = await Callback.sendCallback(Config.DFSP_URLS[from].error, 'put', content.headers, content.payload)
      let metricEndNow = (new Date()).getTime()
      let metricMlAPIProcessMessage = metricEndNow - metricStartNow
      Perf4js.info(msg.value.id, metricMlAPIProcessMessage, 'metricMlAPIProcessMessage')
      return result
    } else if (action.toLowerCase() === 'commit' && status.toLowerCase() === 'success') {
      const result1 = await Callback.sendCallback(`${Config.DFSP_URLS[from].transfers}/${id}`, 'put', content.headers, content.payload)
      const result2 = await Callback.sendCallback(`${Config.DFSP_URLS[to].transfers}/${id}`, 'put', content.headers, content.payload)
      let metricEndNow = (new Date()).getTime()
      let metricMlAPIProcessMessage = metricEndNow - metricStartNow
      Perf4js.info(msg.value.id, metricMlAPIProcessMessage, 'metricMlAPIProcessMessage')
      return result2
    } else if (action.toLowerCase() === 'commit' && status.toLowerCase() !== 'success') {
      const result = await Callback.sendCallback(Config.DFSP_URLS[from].error, 'put', content.headers, content.payload)
      let metricEndNow = (new Date()).getTime()
      let metricMlAPIProcessMessage = metricEndNow - metricStartNow
      Perf4js.info(msg.value.id, metricMlAPIProcessMessage, 'metricMlAPIProcessMessage')
      return result
    } else {
      const err = new Error('invalid action received from kafka')
      Logger.error(`error sending notification to the callback - ${err}`)
      throw err
    }
  } catch (e) {
    throw e
  }
}

module.exports = {
  startConsumer,
  processMessage,
  consumeMessage
}
