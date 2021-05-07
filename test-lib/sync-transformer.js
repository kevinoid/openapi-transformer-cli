/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

// Dynamically imported from tests
// eslint-disable-next-line import/no-unused-modules
export default class SyncTransformer {
  constructor(...args) {
    this.args = args;
  }

  transformOpenApi(openApi) {
    if (openApi === null
      || typeof openApi !== 'object'
      || Array.isArray(openApi)) {
      throw new Error('Invalid openApi object');
    }

    return {
      ...openApi,
      'x-transformers': [
        ...openApi['x-transformers'] || [],
        ['sync-transformer', ...this.args],
      ],
    };
  }
}
