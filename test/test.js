import assert from 'assert'
import sinon from 'sinon'
import Hermoth from '../lib/hermoth'

describe('hermoth', () => {
  describe('connection established', () => {
    let hermoth
    const AMQP_ENDPOINT_URL = 'amqp://0.0.0.0:5672'
    const AMQP_EXCHANGE_NAME = 'test_exchange'

    const EVENT_NAME = 'foo:info'

    it('constructs', async () => {
      hermoth = new Hermoth(AMQP_ENDPOINT_URL, AMQP_EXCHANGE_NAME)
      assert.ok(hermoth)
    })

    it('initiates', async () => {
      const result = await hermoth.init()
      assert.ok(result)
    })

    it('connects', async () => {
      const result = await hermoth.doConnect()
      assert.ok(result)
    })

    it('publishes', async () => {
      const result = await hermoth.publish(EVENT_NAME, { foo: 'bar' })
      assert.ok(result)
    })

    it('subscribes and consumes', () => {
      const listenerStub = sinon.stub()
      hermoth.subscribe(EVENT_NAME, listenerStub)

      const name = EVENT_NAME
      const blob = JSON.parse('{"availabilities":"changed"}')

      hermoth.consume({ content: JSON.stringify({ name, blob }) })
      sinon.assert.called(listenerStub)
    })
  })
})
