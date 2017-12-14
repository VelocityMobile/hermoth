/**
 * A simple implementation of the publish/subscribe messaging pattern on top of
 * an AMQP-compatible message broker.
 */
import { connect } from 'amqplib'
import { delay } from 'bluebird'
import uuid from 'uuid'
import log from 'menna'
import { PrefixedLogger, validateMessageToConsume } from './services/utils'

class Hermoth {
  constructor({
    host,
    exchangeName,
    exchangeType = 'topic',
    queueName = '',
    connectionRetryDelay = 2000,
    logger = log,
    maxConnectionRetries = 100,
    durableExchange = false,
    exclusiveQueue = false,
    queueBindingKey = '#',
    noAck = true,
  }) {
    this.host = host
    this.exchangeName = exchangeName
    this.exchangeType = exchangeType
    this.queueName = queueName
    this.connectionRetryDelay = Number(connectionRetryDelay)
    this.maxConnectionRetries = maxConnectionRetries
    this.log = new PrefixedLogger('pubsub', logger)
    this.durableExchange = durableExchange
    this.exclusiveQueue = exclusiveQueue
    this.queueBindingKey = queueBindingKey
    this.noAck = noAck

    this.listeners = {}
    this.createdQueueName = null
  }

  /**
   * Connects to the message broker and initializes the message exchanged and
   * queues.
   *
   * @return {Promise}
   */
  async init() {
    const conn = await this.connectToMessageBroker(this.host, this.connectionRetryDelay)
    conn.once('close', () => {
      this.log.error('Connection to message broker lost, trying to reconnect..')
      return this.init(this.host, this.exchangeName)
    })

    this.channel = await conn.createChannel()

    if (this.exchangeType) { // If we won't use the default exchange
      // Create the exchange if it doesn't exist
      await this.channel.assertExchange(this.exchangeName, this.exchangeType, { durable: this.durableExchange })
    }

    // Create queue if it doesn't exist. All messages are received from this queue.
    const queue = await this.channel.assertQueue(this.queueName, { exclusive: this.exclusiveQueue })
    this.createdQueueName = queue.queue
    this.log.info(`Connected to queue [${this.createdQueueName}]`)

    // Bind the queue to the exchange so that it can receive messages from it
    this.channel.bindQueue(this.createdQueueName, this.exchangeName, this.queueBindingKey)
    this.log.info(`Bound queue [${this.createdQueueName}] to the exchange [${this.exchangeName}] ` +
      `with key ${this.queueBindingKey} `)

    return this.channel.consume(queue.queue, this.consume.bind(this), { noAck: this.noAck })
  }

  /**
   * Establishes a connection to the message broker.
   *
   * If the connection cannot be established, will keep on trying periodically.
   *
   * @return {Object} An object representing the connection.
   */
  async connectToMessageBroker() {
    let conn
    let connected = false
    let tries = 0
    do {
      try {
        conn = await connect(this.host) // eslint-disable-line no-await-in-loop
        connected = true
        this.log.info(`Connected to message broker ${this.endpointToStr()} `)
      } catch (err) {
        connected = false
        tries += 1
        this.log.error(`Failed to connect to ${this.endpointToStr()}: ${err.code}. ${this.retryConnection ?
          `Retrying in ${this.connectionRetryDelay / 1000} seconds..` : ''} ` +
          `(attempt ${tries}/${this.maxConnectionRetries})`)
        if (tries <= this.maxConnectionRetries) {
          await delay(this.connectionRetryDelay) // eslint-disable-line no-await-in-loop
        } else {
          this.log.error('Maximum number of retries reached.')
          throw err
        }
      }
    } while (!connected)

    return conn
  }

  /**
   * Registers a callback as a listener for the specified message.
   *
   * Such listener will be invoked every time the specified message is received.
   *
   * @param {String}   name     - The message to subscribe.
   * @param {Function} listener - A callback that will be invoked every time the
   *                              subscribed message is received and passed the
   *                              message's payload as an argument.
   *
   * @example
   * subscribe('message_name', (payload) => {
   *   doSomethingWith(payload)
   * })
   */
  subscribe(name, listener) {
    if (this.listeners[name]) {
      this.listeners[name].append(listener)
    } else {
      this.listeners[name] = [listener]
    }
  }

  /**
   * Publishes a message, taking care of JSON-encoding the payload.
   *
   * Note that since publishing a message is a fire-and-forget operation, it is safe
   * to invoke this function synchronously i.e. without using the `await` keyword.
   *
   * @param  {String} name    - The message name.
   * @param  {Object} payload - The message payload.
   * @return {Boolean}        - Whether the message was sent successfully.
   */
  async publish(name, payload) {
    const id = uuid.v4()
    const message = JSON.stringify({ name, id, payload: payload.toJSON ? payload.toJSON() : payload })
    const blob = Buffer.from(message)
    const sent = await this.channel.publish(this.exchangeName, name, blob)
    if (!sent) {
      this.log.warn(`Could not publish message ${name}!`)
    } else {
      this.log.info(`Published message [name=${name},id=${id})] to exchange [${this.exchangeName}]`)
    }
    return sent
  }

  /**
   * Consumes messages received from the message broker, taking care of JSON-decoding
   * the payload and calling the right listener(s).
   *
   * @param  {originalMessage} - AMPQ Message}
   */
  async consume(originalMessage) {
    const blob = originalMessage.content
    validateMessageToConsume(blob)

    const message = JSON.parse(blob)

    if (this.listeners[message.name]) {
      this.log.info(`Received message [name=${message.name}, id=${message.id}] from queue ` +
        `[${this.createdQueueName}]`)

      await Promise.all(
        this.listeners[message.name]
          .map(listener => Promise.resolve(listener.call(this, message, originalMessage))),
      )
    }
  }

  endpointToStr() {
    const endpoint = this.host.includes('@') ? this.host.split('@')[1] : this.host
    return `[${endpoint}]`
  }

}

export default Hermoth
