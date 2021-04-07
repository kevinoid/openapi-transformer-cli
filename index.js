#!/usr/bin/env node
/**
 * @copyright Copyright 2016-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module openapi-transformer-cli
 */

'use strict';

const { Command } = require('commander');
const { createReadStream } = require('fs');
const { load: loadYaml } = require('js-yaml');
const jsonReplaceExponentials = require('json-replace-exponentials');
const path = require('path');
const { debuglog } = require('util');

const packageJson = require('./package.json');

const debug = debuglog('openapi-transformer-cli');

function readString(stream) {
  // Converting Buffer to string in .on('data') breaks split multi-byte chars.
  if (!stream.readableEncoding) {
    throw new Error('stream must have a readableEncoding');
  }

  return new Promise((resolve, reject) => {
    let str = '';
    stream.on('data', (data) => { str += data; });
    stream.once('error', reject);
    stream.once('end', () => resolve(str));
  });
}

async function readJson(stream) {
  try {
    const json = await readString(stream);
    return JSON.parse(json);
  } catch (err) {
    const filename = stream.path || '-';
    err.message += ` in ${filename}`;
    throw err;
  }
}

async function readJsonOrYaml(stream, onWarning) {
  const filename = stream.path || '-';
  try {
    const jsonOrYaml = await readString(stream);
    try {
      return JSON.parse(jsonOrYaml);
    } catch (errJson) {
      debug('Error parsing %s as JSON: %o', filename, errJson);

      return loadYaml(jsonOrYaml, {
        filename,
        onWarning,
        json: true, // don't throw on duplicate keys
      });
    }
  } catch (err) {
    err.message += ` in ${filename}`;
    throw err;
  }
}

async function readConfigFile(stream) {
  const config = await readJson(stream);

  // TODO: Consider using JSON Schema validation

  if (config === null
    || typeof config !== 'object'
    || Array.isArray(config)) {
    throw new TypeError('config file must contain a JSON object');
  }

  for (const key of Object.keys(config)) {
    if (key !== 'transformers') {
      throw new Error(`unrecognized key '${key}' in config`);
    }
  }

  const { transformers } = config;
  if (transformers !== undefined && !Array.isArray(transformers)) {
    throw new TypeError('config.transformers must be an Array');
  }

  for (const transformer of transformers) {
    if (Array.isArray(transformer)) {
      if (transformer.length === 0) {
        throw new Error(
          'config.transformers tuples must at least 1 element',
        );
      }

      if (typeof transformer[0] !== 'string') {
        throw new TypeError(
          'config.transformers tuple first item must be a string',
        );
      }
    } else if (typeof transformer !== 'string') {
      throw new TypeError(
        'config.transformers items must be strings or Arrays',
      );
    }
  }

  config.configFilePath = stream.path;

  return config;
}

function createTransformersForConfig({ configFilePath, transformers }) {
  const searchPath =
    configFilePath ? path.dirname(path.resolve(configFilePath))
      : process.cwd();
  const resolveOptions = { paths: [searchPath] };
  return transformers.map((transformer) => {
    const [name, ...options] =
      Array.isArray(transformer) ? transformer : [transformer];
    const resolved = require.resolve(name, resolveOptions);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const Transformer = require(resolved);
    return new Transformer(...options);
  });
}

async function applyTransformers(configs, openApi) {
  for (const transformers of configs.map(createTransformersForConfig)) {
    for (const transformer of transformers) {
      // eslint-disable-next-line no-await-in-loop
      openApi = await transformer.transformOpenApi(openApi);
    }
  }

  return openApi;
}

/** Entry point for this command.
 *
 * @param {!Array<string>} args Command-line arguments.
 * @param {!object} options Options.
 * @param {function(number)} exit Callback with exit code.
 */
module.exports =
function main(args, options, exit) {
  if (!Array.isArray(args) || args.length < 2) {
    throw new TypeError('args must be an Array with at least 2 elements');
  }
  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (!options.stdin || typeof options.stdin.on !== 'function') {
    throw new TypeError('options.stdin must be a stream.Readable');
  }
  if (!options.stdout || typeof options.stdout.write !== 'function') {
    throw new TypeError('options.stdout must be a stream.Writable');
  }
  if (!options.stderr || typeof options.stderr.write !== 'function') {
    throw new TypeError('options.stderr must be a stream.Writable');
  }
  if (typeof exit !== 'function') {
    throw new TypeError('exit must be a function');
  }

  const configsOrPromises = [];
  const command = new Command()
    .exitOverride()
    .configureOutput({
      writeOut: (str) => options.stdout.write(str),
      writeErr: (str) => options.stderr.write(str),
      getOutHelpWidth: () => options.stdout.columns,
      getErrHelpWidth: () => options.stderr.columns,
    })
    .arguments('[openapi_file]')
    .allowExcessArguments(false)
    // Workaround https://github.com/tj/commander.js/issues/1493
    .action(() => {})
    .description('Transform an OpenAPI document.')
    .option('-c, --config <file>', 'JSON configuration file')
    .on('option:config', (configPath) => {
      const configStream =
        configPath === '-' ? options.stdin : createReadStream(configPath);
      configStream.setEncoding('utf8');
      configsOrPromises.push(readConfigFile(configStream));
    })
    .option(
      '-t, --transformer <module>',
      'transformer module to apply (repeatable)',
    )
    .on('option:transformer', (transformer) => {
      const lastConfig = configsOrPromises[configsOrPromises.length - 1];
      if (lastConfig && lastConfig.transformers) {
        lastConfig.transformers.push(transformer);
      } else {
        configsOrPromises.push({ transformers: [transformer] });
      }
    })
    .version(packageJson.version);

  try {
    command.parse(args);
  } catch (errParse) {
    const exitCode =
      errParse.exitCode !== undefined ? errParse.exitCode : 1;
    process.nextTick(exit, exitCode);
    return;
  }

  const files = command.args;
  if (files.length === 0) {
    if (options.stdin.isTTY) {
      options.stderr.write(
        'Warning: No filename given.  Will read from stdin...\n',
      );
    }

    files.push('-');
  }

  function onWarning(errYaml) {
    options.stderr.write(`${errYaml}\n`);
  }

  const openApiStream =
    files[0] === '-' ? options.stdin : createReadStream(files[0]);
  openApiStream.setEncoding('utf8');

  // eslint-disable-next-line promise/catch-or-return
  Promise.all([
    readJsonOrYaml(openApiStream, onWarning),
    ...configsOrPromises,
  ])
    .then(([openApi, ...configs]) => applyTransformers(configs, openApi))
    .then((openApi) => new Promise((resolve, reject) => {
      const json =
        jsonReplaceExponentials(JSON.stringify(openApi, undefined, 2));
      options.stdout.once('error', reject);
      options.stdout.write(
        `${json}\n`,
        (err) => { if (!err) { resolve(); } },
      );
    }))
    .then(
      () => 0,
      (err) => {
        options.stderr.write(`${err}\n`);
        return 1;
      },
    )
    // Note: nextTick for unhandledException (like util.callbackify)
    .then((exitCode) => process.nextTick(exit, exitCode));
};

if (require.main === module) {
  // This file was invoked directly.
  // Note:  Could pass process.exit as callback to force immediate exit.
  module.exports(process.argv, process, (exitCode) => {
    process.exitCode = exitCode;
  });
}
