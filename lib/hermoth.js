/**
 * A simple implementation of the publish/subscribe messaging pattern on top of
 * an AMQP-compatible message broker.
 */
import { connect } from 'amqplib'
import { delay } from 'bluebird'
import uuid from 'uuid'
import { PrefixedLogger } from './services/utils'

const log = new PrefixedLogger('pubsub')

class Hermoth {
  constructor(amqpEndpoint, amqpExchangeName, connectionRetryDelay = 2000) {
    this.amqpEndpoint = amqpEndpoint
    this.amqpExchangeName = amqpExchangeName
    this.connectionRetryDelay = Number(connectionRetryDelay)
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
      log.error('Connection to message broker lost.')
      return this.init(this.amqpEndpoint, this.amqpExchangeName)
    })

    this.channel = await conn.createChannel()

    // Create exchange if it doesn't exist. All messages are sent to this exchange.
    await this.channel.assertExchange(this.amqpExchangeName, 'fanout', { durable: false })

    // Create queue if it doesn't exist. All messages are received from this queue.
    const queue = await this.channel.assertQueue('', { exclusive: true })
    this.channel.bindQueue(queue.queue, this.amqpExchangeName, '')
    return this.channel.consume(queue.queue, this.consume.bind(this), { noAck: true })
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
    do {
      try {
        conn = await connect(this.amqpEndpoint) // eslint-disable-line no-await-in-loop
        connected = true
        log.info(`Connected to message broker ${this.connDetails()} `)
      } catch (err) {
        connected = false
        log.error(`Failed to connect to ${this.connDetails()}: ${err.code}. Retrying in ${this.connectionRetryDelay / 1000} seconds..`) // eslint-disable-line max-len
        await delay(this.connectionRetryDelay) // eslint-disable-line no-await-in-loop
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
      log.warn(`Could not publish message ${name}!`)
    } else {
      log.info(`Message "${name}" published (${id})`)
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
      log.error('Unable to decode message!')
    }
    if (this.listeners[message.name]) {
      log.info(`Message "${message.name}" received (${message.id})`)
      this.listeners[message.name].forEach(listener => listener.call(null, message.payload, message.name, message.id))
    }
  }

  connDetails() {
    const endpoint = this.amqpEndpoint.includes('@') ? this.amqpEndpoint.split('@')[1] : this.amqpEndpoint
    return `[endpoint: ${endpoint}, exhange: ${this.amqpExchangeName}]`
  }

}

export default Hermoth
