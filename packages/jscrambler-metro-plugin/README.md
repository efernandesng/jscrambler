# Jscrambler Metro Plugin

This metro plugin protects your React Native bundle using Jscrambler.

# Usage

Include the plugin in your `metro.config.js` and add the following code:

```js
const jscramblerMetroPlugin = require('jscrambler-metro-plugin')(
  /* optional */
  {
    params: [
      {
        name: 'selfDefending',
        options: {
          threshold: 1
        }
      }
    ]
  }
);

module.exports = jscramblerMetroPlugin;
```

You can pass your Jscrambler configuration using the plugin parameter or using
the usual `.jscramblerrc` file.
