/* eslint-env node*/

import assert from 'assert'
import { map } from 'ramda'
import sinon from 'sinon'
import { init, publish, consume, subscribe } from './../lib/hermoth'

describe('hermoth', () => {
    describe('connection established', () => {

        it('initiates', async () => {
            let result = await init()
            assert.ok(result)
        });

        it('publishes', async () => {
            let result = await publish('Test Name', {"Somethin Real": "Minions"})
            assert.ok(result)
        });

        // it('consumes', async() => {
        //     subscribe()
        //     let name = "Test Name"
        //     let blob = JSON.parse('{"Somethin Real": "Minions"}')
        //     let result = await consume({content: JSON.stringify({name, blob})})
        //     assert.ok(result)
        // });
    });
});
