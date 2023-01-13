OpenAPI Transformer CLI
=======================

[![Build Status](https://img.shields.io/github/actions/workflow/status/kevinoid/openapi-transformer-cli/node.js.yml?branch=main&style=flat&label=build)](https://github.com/kevinoid/openapi-transformer-cli/actions?query=branch%3Amain)
[![Coverage](https://img.shields.io/codecov/c/github/kevinoid/openapi-transformer-cli/main.svg?style=flat)](https://app.codecov.io/gh/kevinoid/openapi-transformer-cli/branch/main)
[![Dependency Status](https://img.shields.io/librariesio/release/npm/@kevinoid/openapi-transformer-cli.svg?style=flat)](https://libraries.io/npm/@kevinoid%2Fopenapi-transformer-cli)
[![Supported Node Version](https://img.shields.io/node/v/@kevinoid/openapi-transformer-cli.svg?style=flat)](https://www.npmjs.com/package/@kevinoid/openapi-transformer-cli)
[![Version on NPM](https://img.shields.io/npm/v/@kevinoid/openapi-transformer-cli.svg?style=flat)](https://www.npmjs.com/package/@kevinoid/openapi-transformer-cli)

An executable to transform [OpenAPI](https://www.openapis.org/) documents by
applying [OpenAPI
Transformers](https://github.com/kevinoid/openapi-transformer-base).


## Introductory Example

```sh
openapi-transformer -t @kevinoid/openapi-transformers/remove-response-headers.js <input.json >output.json
```


## Features

*


## Installation

[This package](https://www.npmjs.com/package/@kevinoid/openapi-transformer-cli) can be
installed using [npm](https://www.npmjs.com/), either globally or locally, by
running:

```sh
npm install @kevinoid/openapi-transformer-cli
```


## Contributing

Contributions are appreciated.  Contributors agree to abide by the [Contributor
Covenant Code of
Conduct](https://www.contributor-covenant.org/version/1/4/code-of-conduct.html).
If this is your first time contributing to a Free and Open Source Software
project, consider reading [How to Contribute to Open
Source](https://opensource.guide/how-to-contribute/)
in the Open Source Guides.

If the desired change is large, complex, backwards-incompatible, can have
significantly differing implementations, or may not be in scope for this
project, opening an issue before writing the code can avoid frustration and
save a lot of time and effort.


## License

This project is available under the terms of the [MIT License](LICENSE.txt).
See the [summary at TLDRLegal](https://tldrlegal.com/license/mit-license).
