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
      amqpEndpoint: AMQP_ENDPOINT_URL,
      amqpExchangeName: AMQP_EXCHANGE_NAME,
      connectionRetryDelay: 3000,
      logger,
      maxRetries: 1,
    }, overrideOptions)
    return new Hermoth(args)
  }

  describe('construction', () => {
    it('constructs with the new options', () => {
      const options = {
        amqpEndpoint: 'amqpEndpoint',
        amqpExchangeName: 'amqpExchangeName',
        connectionRetryDelay: 3000,
        maxRetries: 10,
      }
      const hermoth = hermothFactory(options)

      assert.equal('amqpEndpoint', hermoth.amqpEndpoint)
      assert.equal('amqpExchangeName', hermoth.amqpExchangeName)
      assert.equal(3000, hermoth.connectionRetryDelay)
      assert.equal(10, hermoth.maxRetries)
    })
  })

  describe('connection established', () => {
    let hermoth
    let connectStub = null
    let channelStub = null

    const setupHermoth = () => {
      amqplib.connect = sinon.stub()
      amqplib.connect.onFirstCall().returns(connectStub)
      hermoth = hermothFactory()
    }

    beforeEach(() => {
      channelStub = {
        assertExchange: sinon.stub(),
        assertQueue: sinon.stub().returns({ queue: null }),
        bindQueue: sinon.stub(),
        consume: sinon.stub().returns({}),
        publish: sinon.stub().returns(true),
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
      sinon.assert.called(logger.info)
    })

    it('connects', async () => {
      setupHermoth()

      const result = await hermoth.doConnect()
      assert.equal(connectStub, result)
    })

    it('throws an error connected after the second attempt', async () => {
      amqplib.connect = sinon.stub()
      const expectedError = { code: 2 }
      amqplib.connect.onFirstCall().throws({ code: 1 })
        .onSecondCall()
        .throws(expectedError)

      let error = null
      hermoth = hermothFactory({ connectionRetryDelay: 0, maxRetries: 1 })

      try {
        await hermoth.doConnect()
      } catch (e) {
        error = e
      }
      assert.equal(error, expectedError)
      sinon.assert.called(logger.error)
    })

    it('publishes', async () => {
      setupHermoth()

      const expectedPayload = { foo: 'bar' }
      await hermoth.init()
      const result = await hermoth.publish(EVENT_NAME, expectedPayload)

      const args = channelStub.publish.getCall(0).args
      assert.equal(args[0], AMQP_EXCHANGE_NAME)
      assert.equal(args[1], '')

      const data = JSON.parse(args[2])
      assert.deepEqual(data.payload, expectedPayload)
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id))
      assert.equal(data.name, EVENT_NAME)
      assert.ok(result)
    })

    it('subscribes and consumes', async () => {
      setupHermoth()

      const listenerStub = sinon.stub()
      hermoth.subscribe(EVENT_NAME, listenerStub)

      const id = 42
      const name = EVENT_NAME
      const payload = { availabilities: 'changed' }

      await hermoth.consume({ content: JSON.stringify({ id, name, payload }) })
      sinon.assert.calledWith(listenerStub, payload, name, id)
    })
  })
})
