# Hermoth

> Norse Messenger God

[![CircleCI](https://circleci.com/gh/VelocityMobile/hermoth/tree/master.svg?style=shield)](https://circleci.com/gh/VelocityMobile/hermoth/tree/master)

A wrapper for an AMQP-compatible message broker.

## Installation

```sh
npm install hermoth
```

## Running locally

```sh
npm install
npm test
```

## Usage

```javascript
import Hermoth from 'hermoth'

const hermoth = new Hermoth(options) // see below for `options` examples

// connect or create the exchange and the queue, and start consuming messages
hermoth.init()
```

Subscribe to messages:

```javascript
hermoth.subscribe('my-message-name', function consume(msg) {
  console.log(msg)
})
```

Publish messages:

```javascript
const msg = { someData: {} }
hermoth.publish('my-message-name', msg )
```

## Use cases

At [@velocityapp](https://github.com/VelocityMobile) we have multiple instances (replicas) of the same service running in parallel.

Some messages need to be received by all instances of the application and processed , but some need to be received and processed by a single instance of the same application type only. You can find how to configure Hermoth to satisfy both needs below.

### Use case 1: Only one instance of the same application type receives the message

You can achieve this by creating a queue with a specific name, and have the instances connect to this queue.

The message broker will deliver the messages in round robin fashion per [spec](http://www.rabbitmq.com/tutorials/amqp-concepts.html) ([competing consumers pattern](http://www.enterpriseintegrationpatterns.com/patterns/messaging/CompetingConsumers.html))

```javascript
import Hermoth from 'hermoth'

const worker = new Hermoth({
  host: 'amqp://localhost:5672',
  exchangeName: 'exchange_name',
  queueName: 'my_service_queue',
  durable: true
})
```

If you want to make sure the message is processed, pass `noAck = true` and acknowledge the processing of the message. It's very important to acknowledge the message or else the broker will keep re-queueing and delivering it.

```javascript
import Hermoth from 'hermoth'

const worker = new Hermoth({
  // ...
  noAck: false
})

worker.subscribe('message:type', function consume(msg, originalMessage) {
  process(msg.payload)
  this.channel.ack(originalMessage)
})
```

### Use case 2: All instances of the same application type receives the same message

You can achieve this by having each instance of the application creating their own anonymous and disposable queues. Notice we don't pass a `queueName` to the constructor; the broker to generate a random one for us.

```javascript
import Hermoth from 'hermoth'

const consumer = new Hermoth({
  host: 'amqp://localhost:5672',
  exchangeName: 'exchange_name',
  exclusiveQueue: true
})
```
