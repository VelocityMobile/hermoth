/**
 * A simple implementation of the publish/subscribe messaging pattern on top of
 * an AMQP-compatible message broker.
 */
import { connect } from 'amqplib'
import { delay } from 'bluebird'
import uuid from 'uuid'
import log from 'menna'
import { PrefixedLogger, parseMessage } from './utils'

class Hermoth {
  constructor({
    host,
    exchangeName,
    exchangeType = 'topic',
    queueName = '',
    connectionRetryDelayInMs = 2000,
    logger = log,
    maxConnectionRetries = 100,
    durableExchange = false,
    durableQueue = false,
    persistentMessages = false,
    exclusiveQueue = false,
    queueBindingKey = '#',
    noAck = true,
  }) {
    this.host = host
    this.exchangeName = exchangeName
    this.exchangeType = exchangeType
    this.queueName = queueName
    this.connectionRetryDelayInMs = Number(connectionRetryDelayInMs)
    this.maxConnectionRetries = maxConnectionRetries
    this.log = new PrefixedLogger('pubsub', logger)
    this.durableExchange = durableExchange
    this.durableQueue = durableQueue
    this.persistentMessages = persistentMessages
    this.exclusiveQueue = exclusiveQueue
    this.queueBindingKey = queueBindingKey
    this.noAck = noAck

    this.listeners = {}
    this.createdQueueName = null
    this.restartInProgress = false
  }

  /**
   * Connects to the message broker and initializes the message exchanged and
   * queues.
   *
   * @return {Promise}
   */
  async init() {
    this.conn = await this.connectToMessageBroker(this.host, this.connectionRetryDelayInMs)
    this.conn.on('close', this.handleConnectionClose.bind(this))

    this.channel = await this.conn.createChannel()
    this.channel.on('error', this.handleChannelClose.bind(this))

    if (this.exchangeType) { // If we won't use the default exchange
      // Create the exchange if it doesn't exist
      await this.channel.assertExchange(this.exchangeName, this.exchangeType, { durable: this.durableExchange })
      this.log.info(`Connected to exchange [${this.exchangeName}]`)
    }

    // Create queue if it doesn't exist. All messages are received from this queue.
    const queueOptions = {
      exclusive: this.exclusiveQueue,
      persistent: this.durableQueue,
      autoDelete: this.exclusiveQueue && !this.durableQueue
    }
    const queue = await this.channel.assertQueue(this.queueName, queueOptions)
    this.createdQueueName = queue.queue
    this.log.info(`Connected to queue [${this.createdQueueName}]`)

    // Bind the queue to the exchange so that it can receive messages from it
    this.channel.bindQueue(this.createdQueueName, this.exchangeName, this.queueBindingKey)
    this.log.info(`Bound queue [${this.createdQueueName}] to the exchange [${this.exchangeName}] ` +
      `with key ${this.queueBindingKey} `)
    this.channel.consume(queue.queue, this.consume.bind(this), { noAck: this.noAck })
    this.restartInProgress = false
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
        this.log.info(`Connected to message broker [${this.endpointToStr()}]`)
      } catch (err) {
        connected = false
        tries += 1
        this.log.error('Failed to connect to exchange ' +
          `[host=${this.endpointToStr()},name=${this.exchangeName},queue=${this.queueName}]:
            ${err.code}. ${this.retryConnection ? `Retrying in ${this.connectionRetryDelayInMs / 1000} seconds..` : ''} ` +
          `(attempt ${tries}/${this.maxConnectionRetries})`)
        if (tries <= this.maxConnectionRetries) {
          await delay(this.connectionRetryDelayInMs) // eslint-disable-line no-await-in-loop
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
    const sent = await this.channel.publish(this.exchangeName, name, blob, { persistent: this.persistentMessages })
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
    let message
    try {
      message = parseMessage(originalMessage)
    } catch (e) {
      this.log.error(`Invalid message: ${originalMessage}`)
      return
    }

    if (this.listeners[message.name]) {
      this.log.info(`Received message [name=${message.name}, id=${message.id}] from queue ` +
        `[${this.createdQueueName}]`)

      const ackCallback = () => this.channel.ack(originalMessage)
      await Promise.all(
        this.listeners[message.name]
          .map(listener => Promise.resolve(listener.call(this, message, ackCallback))),
      )
    }
  }

  async handleConnectionClose(err) {
    if (this.restartInProgress) {
      this.log.warn('Ignoring closed connection as another handler initiated a restart already')
      return
    }
    this.restartInProgress = true
    this.log.error('Connection to message broker lost, trying to reconnect..\n', err)

    try {
      await this.channel.close()
      this.log.info('Channel successfully closed')
    } catch (alreadyClosed) {
      this.log.warn('Channel was already closed', alreadyClosed.stackAtStateChange)
    }

    this.init()
  }

  async handleChannelClose(err) {
    if (this.restartInProgress) {
      this.log.warn('Ignoring closed channel as another handler initiated a restart already')
      return
    }
    this.restartInProgress = true
    this.log.error('Re-creating the channel as it was closed with reason:\n', err)


    try {
      await this.conn.close()
      this.log.info('Connection successfully closed')
    } catch (alreadyClosed) {
      this.log.warn('Connection was already closed', alreadyClosed.stackAtStateChange)
    }

    this.init()
  }

  endpointToStr() {
    return this.host.includes('@') ? this.host.split('@')[1] : this.host
  }

}

export default Hermoth
