/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

module.exports =
class AsyncTransformer {
  constructor(...args) {
    this.args = args;
  }

  async transformOpenApi(openApi) {
    if (openApi === null
      || typeof openApi !== 'object'
      || Array.isArray(openApi)) {
      throw new Error('Invalid openApi object');
    }

    return {
      ...openApi,
      'x-transformers': [
        ...openApi['x-transformers'] || [],
        ['async-transformer', ...this.args],
      ],
    };
  }
};
