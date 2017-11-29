/**
 * A simple implementation of the publish/subscribe messaging pattern on top of
 * an AMQP-compatible message broker.
 */
import { connect } from 'amqplib'
import { delay } from 'bluebird'
import uuid from 'uuid'
import { PrefixedLogger } from './services/utils'

class Hermoth {
  constructor({
    amqpEndpoint,
    amqpExchangeName,
    connectionRetryDelay = 2000,
    logger,
    maxRetries = null,
    durable = false,
    noAck = true,
  }) {
    this.amqpEndpoint = amqpEndpoint
    this.amqpExchangeName = amqpExchangeName
    this.connectionRetryDelay = Number(connectionRetryDelay)
    this.maxRetries = maxRetries
    this.log = new PrefixedLogger('pubsub', logger)
    this.durable = durable
    this.noAck = noAck

    this.listeners = {}
  }

  /**
   * Connects to the message broker and initializes the message exchanged and
   * queues.
   *
   * @return {Promise}
   */
  async init() {
    const conn = await this.doConnect(this.amqpEndpoint, this.connectionRetryDelay)
    conn.once('close', () => {
      this.log.error('Connection to message broker lost.')
      return this.init(this.amqpEndpoint, this.amqpExchangeName)
    })

    this.channel = await conn.createChannel()

    // Create exchange if it doesn't exist. All messages are sent to this exchange.
    await this.channel.assertExchange(this.amqpExchangeName, 'fanout', { durable: this.durable })

    // Create queue if it doesn't exist. All messages are received from this queue.
    const queue = await this.channel.assertQueue('', { exclusive: true })
    this.channel.bindQueue(queue.queue, this.amqpExchangeName, '')
    return this.channel.consume(queue.queue, this.consume.bind(this), { noAck: this.noAck })
  }

  /**
   * Establishes a connection to the message broker.
   *
   * If the connection cannot be established, will keep on trying periodically.
   *
   * @return {Object} An object representing the connection.
   */
  async doConnect() {
    let conn
    let connected = false
    let tries = 0
    do {
      try {
        conn = await connect(this.amqpEndpoint) // eslint-disable-line no-await-in-loop
        connected = true
        this.log.info(`Connected to message broker ${this.connDetails()} `)
      } catch (err) {
        connected = false
        tries += 1
        this.log.error(`Failed to connect to ${this.connDetails()}: ${err.code}. ${this.retryConnection ? `Retrying in ${this.connectionRetryDelay / 1000} seconds..` : ''} (attempt ${tries}/${this.maxRetries})`) // eslint-disable-line max-len
        if (tries <= this.maxRetries) {
          await delay(this.connectionRetryDelay) // eslint-disable-line no-await-in-loop
        } else {
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
    const sent = await this.channel.publish(this.amqpExchangeName, '', blob)
    if (!sent) {
      this.log.warn(`Could not publish message ${name}!`)
    } else {
      this.log.info(`Message "${name}" published (${id})`)
    }
    return sent
  }

  /**
   * Consumes messages received from the message broker, taking care of JSON-decoding
   * the payload and calling the right listener(s).
   *
   * @param  {{ content: Buffer }}
   */
  async consume({ content: blob }) {
    let message
    try {
      message = JSON.parse(blob)
    } catch (err) {
      if (err.constructor !== SyntaxError) {
        throw err
      }
      this.log.error('Unable to decode message!')
    }
    if (this.listeners[message.name]) {
      this.log.info(`Message "${message.name}" received (${message.id})`)

      await Promise.all(
        this.listeners[message.name]
          .map(listener => Promise.resolve(listener.call(this, message.payload, message.name, message.id))),
      )

      if (!this.noAck) {
        await this.channel.ack(message)
      }
    }
  }

  connDetails() {
    const endpoint = this.amqpEndpoint.includes('@') ? this.amqpEndpoint.split('@')[1] : this.amqpEndpoint
    return `[endpoint: ${endpoint}, exhange: ${this.amqpExchangeName}]`
  }

}

export default Hermoth
