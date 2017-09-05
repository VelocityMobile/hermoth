/**
 * A simple implementation of the publish/subscribe messaging pattern on top of
 * an AMQP-compatible message broker.
 */

import { connect } from 'amqplib';
import { delay } from 'bluebird';
import uuid from 'uuid';
import { PrefixedLogger } from './services/utils';

const log = new PrefixedLogger('pubsub');
const listeners = {};

class Hermoth {
    constructor(amqpEndpointUrl, amqpExchangeName, connectionRetryDelay = 2000) {
        this.amqpEndpoint = amqpEndpointUrl;
        this.amqpName = amqpExchangeName;
        this.channel = undefined;
        this.connectRetryDelay = connectionRetryDelay
    }

    /**
     * Establishes a connection to the message broker.
     *
     * If the connection cannot be established, will keep on trying periodically.
     *
     * @return {Object} An object representing the connection.
     */
    async doConnect () {
        let conn;
        let connected = false;
        do {
            try {
                conn = await connect(this.amqpEndpoint); // eslint-disable-line no-await-in-loop
                connected = true
            } catch (err) {
                log.error(`Failed to connect to message broker (${err.code}). Retrying in ${this.connectRetryDelay / 1000} seconds...`); // eslint-disable-line max-len
                connected = false;
                await delay(this.connectRetryDelay); // eslint-disable-line no-await-in-loop
            }
        } while (!connected);

        return conn;
    }

    /**
     * Consumes messages received from the message broker, taking care of JSON-decoding
     * the payload and calling the right listener(s).
     *
     * @param  {{ content: Buffer }}
     */
    consume ({ content: blob }) {
        let message;
        try {
            message = JSON.parse(blob);
        } catch (err) {
            if (err.constructor !== SyntaxError) {
                throw err;
            }
            log.error('Unable to decode message!');
        }
        if (listeners[message.name]) {
            log.info(`Message "${message.name}" received (${message.id})`);
            listeners[message.name].forEach(listener => listener.call(null, message.payload, message.name));
        }
    }

    /**
     * Connects to the message broker and initializes the message exchanged and
     * queues.
     *
     * @return {Promise}
     */
    async init () {
        const conn = await this.doConnect();
        conn.once('close', () => {
            log.error('Connection to message broker lost.');
            return this.init(); // try to reconnect
        });

        this.channel = await conn.createChannel();
        log.info('Connected to message broker.');

        // Create exchange if it doesn't exist. All messages are sent to this exchange.
        await this.channel.assertExchange(this.amqpName, 'fanout', { durable: false });

        // Create queue if it doesn't exist. All messages are received from this queue.
        const queue = await this.channel.assertQueue('', { exclusive: true });
        this.channel.bindQueue(queue.queue, this.amqpName, '');

        return this.channel.consume(queue.queue, this.consume, { noAck: true });
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
    async publish (name, payload) {
        const id = uuid.v4();
        const message = JSON.stringify({ name, id, payload: payload.toJSON ? payload.toJSON() : payload });
        const blob = Buffer.from(message);
        const sent = await this.channel.publish(this.amqpName, '', blob);
        if (!sent) {
            log.warn(`Could not publish message ${name}!`);
        } else {
            log.info(`Message "${name}" published (${id})`);
        }
        return sent;
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
    subscribe (name, listener) {
        if (listeners[name]) {
            listeners[name].append(listener)
        } else {
            listeners[name] = [listener]
        }
    }
}

export default Hermoth