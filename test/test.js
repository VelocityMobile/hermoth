import assert from 'assert'
import sinon from 'sinon'
import Hermoth from '../lib/hermoth'

describe('hermoth', () => {
  describe('connection established', () => {
    let hermoth
    const AMQP_ENDPOINT_URL = 'amqp://0.0.0.0:5672'
    const AMQP_EXCHANGE_NAME = 'test_exchange'

    const EVENT_NAME = 'foo:info'
    const EVENT_NAME2 = 'baz:info'

    const uuidV1 = '4a3ea0c5-cff6-4a88-aeab-26b4e2d6497a'
    const uuidV2 = '0ce231f8-8331-4398-9232-8eb16474f87c'

    const payload1 = { foo: 'bar' }
    const payload2 = { baz: 'bit' }

    it('constructs', () => {
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

    it('publishes to foo', async () => {
      const result = await hermoth.publish(EVENT_NAME, payload1)
      assert.ok(result)
    })

    it('subscribes and consumes when listener is not a promise', () => {
      const listenerStub = sinon.stub()
      hermoth.subscribe(EVENT_NAME, listenerStub)

      const blob = `{"payload":{"foo":"bar"},"name":"${EVENT_NAME}","id":"${uuidV1}"}`

      hermoth.consume({ content: blob })
      sinon.assert.calledWith(listenerStub, payload1, EVENT_NAME)
    })

    it('publishes to baz', async () => {
      const result = await hermoth.publish(EVENT_NAME, payload2)
      assert.ok(result)
    })

    it('subscribes and consumes when listener is a promise', () => {
      const listenerStub = sinon.stub().returns(Promise)
      hermoth.subscribe(EVENT_NAME2, listenerStub)

      const blob = `{"payload":{"baz":"bit"},"name":"${EVENT_NAME2}","id":"${uuidV2}"}`

      hermoth.consume({ content: blob })
      sinon.assert.calledWith(listenerStub, payload2, EVENT_NAME2)
    })
  })
})
