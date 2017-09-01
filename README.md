 # hermoth
 > Norse Messenger God 
 
 [![CircleCI](https://circleci.com/gh/VelocityMobile/hermoth/tree/master.svg?style=shield)](https://circleci.com/gh/VelocityMobile/hermoth/tree/master)
 
 A wrapper for the publish/subscribe messaging pattern on top of an AMQP-compatible message broker.
 
 ## Installation & Testing
 
  ```sh
  npm install
  npm test
  ```
  
  ## Usage
  
  The settings can be configured with environment variables
  
  ```javascript
  import Hermoth from 'hermoth';
  const AMQP_ENDPOINT_URL = process.env.AMQP_ENDPOINT_URL;
  const AMQP_EXCHANGE_NAME = process.env.AMQP_EXCHANGE_NAME;
  const hermoth = new Hermoth(AMQP_ENDPOINT_URL, AMQP_EXCHANGE_NAME); // retry time defaults to 2000 milliseconds - pass in as third parameter 
  hermoth.init(); // starts a connection
  ```