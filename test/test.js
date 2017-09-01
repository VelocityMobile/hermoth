/* eslint-env node*/

import assert from 'assert';
import sinon from 'sinon';
import Hermoth from '../lib/hermoth';
let hermoth = new Hermoth('amqp://localhost:5672', 'erb');


describe('hermoth', () => {
    describe('connection established', () => {
        it('initiates', async () => {
            let doConnectSpy = sinon.spy(hermoth, 'doConnect');
            let result = await hermoth.init();
            sinon.assert.called(doConnectSpy);
            assert.ok(result);
        });

        it('does connection', async () => {
            let result = await hermoth.doConnect();
            assert.ok(result);
        });

        it('publishes', async () => {
            let result = await hermoth.publish('join:created', {"availabilities":"changed"});
            assert.ok(result);
        });

        it('consumes and subscribes', () => {
            let listenerStub = sinon.stub();
            hermoth.subscribe('join:created', listenerStub);
            let name = "join:created";
            let blob = JSON.parse('{"availabilities":"changed"}');
            hermoth.consume({content: JSON.stringify({name, blob})});
            sinon.assert.called(listenerStub);
        });
    });
});
