import assert from 'assert'
import sinon from 'sinon'
import amqplib from 'amqplib'
import Hermoth from '../lib/hermoth'

const AMQP_ENDPOINT_URL = 'amqp://0.0.0.0:5672'
const AMQP_EXCHANGE_NAME = 'test_exchange'
const EVENT_NAME = 'foo:info'

describe('hermoth', () => {
  const logger = {
    levels: { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 },
    info: sinon.stub(),
    debug: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub(),
  }
  const hermothFactory = (overrideOptions = {}) => {
    const args = Object.assign({
      host: AMQP_ENDPOINT_URL,
      exchangeName: AMQP_EXCHANGE_NAME,
      exchangeType: 'direct',
      queueName: 'my_queue',
      connectionRetryDelayInMs: 3000,
      logger,
      maxConnectionRetries: 1,
      durableExchange: false,
      exclusiveQueue: true,
      queueBindingKey: '.',
      noAck: true,
    }, overrideOptions)
    return new Hermoth(args)
  }

  const MESSAGE = { id: 42, name: 'foo:info', payload: { availabilities: 'changed' } }
  const ORIGINAL_MESSAGE = {
    fields:
    {
      consumerTag: 'amq.ctag-UncQHYi6cmGDfr2_UarlkA',
      deliveryTag: 1,
      redelivered: false,
      exchange: '',
      routingKey: 'bookings',
    },
    properties:
    {
      deliveryMode: 1,
    },
    content: JSON.stringify(MESSAGE),
  }

  describe('construction', () => {
    it('constructs with the new options', () => {
      const options = {
        host: 'amqpEndpoint',
        exchangeName: 'amqpExchangeName',
        exchangeType: 'fanout',
        queueName: 'my_queue',
        connectionRetryDelayInMs: 3000,
        maxConnectionRetries: 10,
        durableExchange: true,
        durableQueue: true,
        persistentMessages: true,
        exclusiveQueue: true,
        queueBindingKey: '.',
        noAck: true,
      }
      const hermoth = hermothFactory(options)

      assert.equal('amqpEndpoint', hermoth.host)
      assert.equal('amqpExchangeName', hermoth.exchangeName)
      assert.equal('fanout', hermoth.exchangeType)
      assert.equal('my_queue', hermoth.queueName)
      assert.equal(3000, hermoth.connectionRetryDelayInMs)
      assert.equal(10, hermoth.maxConnectionRetries)
      assert.equal(true, hermoth.durableExchange)
      assert.equal(true, hermoth.durableQueue)
      assert.equal(true, hermoth.persistentMessages)
      assert.equal(true, hermoth.exclusiveQueue)
      assert.equal('.', hermoth.queueBindingKey)
      assert.equal(true, hermoth.noAck)
    })
  })

  describe('connection established', () => {
    let hermoth
    let connectStub = null
    let channelStub = null

    const setupHermoth = (overrideOptions = {}) => {
      amqplib.connect = sinon.stub()
      amqplib.connect.returns(connectStub)
      hermoth = hermothFactory(overrideOptions)
    }

    beforeEach(() => {
      channelStub = {
        assertExchange: sinon.stub(),
        assertQueue: sinon.stub().returns({ queue: 'my_queue' }),
        bindQueue: sinon.stub(),
        consume: sinon.stub().returns({}),
        publish: sinon.stub().returns(true),
        ack: sinon.stub(),
      }

      connectStub = {
        once: sinon.stub(),
        createChannel: sinon.stub().returns(channelStub),
      }
    })

    it('initiates', async () => {
      setupHermoth()

      const result = await hermoth.init()

      assert.ok(result)
      sinon.assert.called(connectStub.createChannel)
      sinon.assert.calledWith(channelStub.assertExchange,
        hermoth.exchangeName, hermoth.exchangeType, { durable: hermoth.durableExchange })
      sinon.assert.calledWith(channelStub.assertQueue, hermoth.queueName,
        { exclusive: hermoth.exclusiveQueue, persistent: hermoth.durableQueue })
      sinon.assert.calledWith(channelStub.bindQueue,
        hermoth.queueName, hermoth.exchangeName, hermoth.queueBindingKey)
      sinon.assert.calledWith(channelStub.consume,
        hermoth.queueName, sinon.match.func, { noAck: hermoth.noAck })
    })

    it('connects to default exchange if no exchange type is given', async () => {
      setupHermoth({ exchangeType: null })

      const result = await hermoth.init()

      assert.ok(result)
      sinon.assert.notCalled(channelStub.assertExchange)
    })

    it('connects', async () => {
      setupHermoth()

      const result = await hermoth.connectToMessageBroker()
      assert.equal(connectStub, result)
    })

    it('throws an error connected after the second attempt', async () => {
      amqplib.connect = sinon.stub()
      const expectedError = { code: 2 }
      amqplib.connect.onFirstCall().throws({ code: 1 })
        .onSecondCall()
        .throws(expectedError)

      let error = null
      hermoth = hermothFactory({ connectionRetryDelayInMs: 0, maxRetries: 1 })

      try {
        await hermoth.connectToMessageBroker()
      } catch (e) {
        error = e
      }
      assert.equal(error, expectedError)
      sinon.assert.called(logger.error)
    })

    it('publishes', async () => {
      setupHermoth()
      await hermoth.init()

      const expectedPayload = { foo: 'bar' }
      const result = await hermoth.publish(EVENT_NAME, expectedPayload)
      sinon.assert.called(channelStub.publish)

      const args = channelStub.publish.getCall(0).args
      assert.equal(args[0], AMQP_EXCHANGE_NAME)
      assert.equal(args[1], 'foo:info')

      const data = JSON.parse(args[2])
      assert.deepEqual(data.payload, expectedPayload)
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id))
      assert.equal(data.name, EVENT_NAME)
      assert.ok(result)
    })

    it('subscribes and consumes when listener is not a promise', async () => {
      setupHermoth()
      await hermoth.init()

      const listenerStub = sinon.stub()
      hermoth.subscribe(EVENT_NAME, listenerStub)

      const ack = sinon.match.func

      await hermoth.consume(ORIGINAL_MESSAGE)
      sinon.assert.calledWith(listenerStub, MESSAGE, ack)
    })

    it('subscribes and consumes when listener is a promise', async () => {
      setupHermoth()
      await hermoth.init()

      const listenerStub = sinon.stub().returns(Promise)
      hermoth.subscribe(EVENT_NAME, listenerStub)

      const ack = sinon.match.func

      await hermoth.consume(ORIGINAL_MESSAGE)
      sinon.assert.calledWith(listenerStub, MESSAGE, ack)
    })
  })
})
