/* eslint-env node*/

import assert from 'assert';
import sinon from 'sinon';
import {init, publish, subscribe, doConnect, consume} from '../lib/hermoth';

describe('hermoth', () => {
    describe('connection established', () => {
        it('initiates', async () => {
            let result = await init('amqp://0.0.0.0:5672', 'erb');
            assert.ok(result);
        });

        it('does connection', async () => {
            let result = await doConnect();
            assert.ok(result);
        });

        it('publishes', async () => {
            let result = await publish('join:created', {"availabilities":"changed"});
            assert.ok(result);
        });

        it('consumes and subscribes', () => {
            let listenerStub = sinon.stub();
            subscribe('join:created', listenerStub);
            let name = "join:created";
            let blob = JSON.parse('{"availabilities":"changed"}');
            consume({content: JSON.stringify({name, blob})});
            sinon.assert.called(listenerStub);
        });
    });
});
