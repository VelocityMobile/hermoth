import assert from 'assert'
import sinon from 'sinon'
import amqplib from 'amqplib'
import Hermoth from '../lib/hermoth'

const AMQP_ENDPOINT_URL = 'amqp://0.0.0.0:5672'
const AMQP_EXCHANGE_NAME = 'test_exchange'
const EVENT_NAME = 'foo:info'

describe('hermoth', () => {
  describe('construction', () => {
    it('constructs', () => {
      const hermoth = new Hermoth(AMQP_ENDPOINT_URL, AMQP_EXCHANGE_NAME)
      assert.ok(hermoth)
    })

    it('constructs with the new options', () => {
      const hermoth = new Hermoth({
        amqpEndpoint: AMQP_ENDPOINT_URL,
        amqpExchangeName: AMQP_EXCHANGE_NAME,
        connectionRetryDelay: 3000,
        disableConnectionRetry: true,
      })

      assert.equal(AMQP_ENDPOINT_URL, hermoth.amqpEndpoint)
      assert.equal(AMQP_EXCHANGE_NAME, hermoth.amqpExchangeName)
      assert.equal(3000, hermoth.connectionRetryDelay)
      assert.equal(false, hermoth.retryConnection)
    })
  })

  describe('connection established', () => {
    let hermoth
    let connectStub = null
    let channelStub = null
    let mockAmqpLib

    beforeEach(() => {
      mockAmqpLib = sinon.mock(amqplib)

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

      mockAmqpLib.expects('connect').once().returns(connectStub)

      hermoth = new Hermoth({
        amqpEndpoint: AMQP_ENDPOINT_URL,
        amqpExchangeName: AMQP_EXCHANGE_NAME,
        connectionRetryDelay: 3000,
        disableConnectionRetry: true,
      })
    })

    afterEach(() => mockAmqpLib.restore())

    it('initiates', async () => {
      const result = await hermoth.init()

      assert.ok(result)
      assert(mockAmqpLib.verify())
    })

    it('connects', async () => {
      const result = await hermoth.doConnect()
      assert.equal(connectStub, result)
    })

    it('publishes', async () => {
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
