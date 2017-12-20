import chalk from 'chalk'

export class PrefixedLogger { // eslint-disable-line import/prefer-default-export
  constructor(prefix, logger, colour = 'gray') {
    this.prefix = prefix
    this.levels = Object.keys(logger.levels)
    return new Proxy(logger, {
      get: (target, name) => {
        if (this.levels.includes(name)) {
          return function override(...args) {
            args[0] = chalk[colour](`[${prefix}] ${args[0]}`) // eslint-disable-line no-param-reassign
            return target[name](...args)
          }
        }
        return target[name]
      },
    })
  }
}

export const parseMessage = (msg) => {
  const content = msg ? msg.content : null

  let message
  try {
    message = JSON.parse(content)
  } catch (err) {
    throw new Error(`Unable to parse the message to JSON!
        Message content was: ${content},
        Original error is ${err}`)
  }
  if (!message || !message.id || !message.name || !message.payload) {
    throw new Error(`Message doesn't have some of [id,name,payload]: ${message}`)
  }

  return message
}
