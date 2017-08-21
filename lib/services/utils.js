import menna from 'menna'
import chalk from 'chalk'

export class PrefixedLogger { // eslint-disable-line import/prefer-default-export
  constructor(prefix, colour = 'gray') {
    this.prefix = prefix
    this.levels = Object.keys(menna.levels)
    return new Proxy(menna, {
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
