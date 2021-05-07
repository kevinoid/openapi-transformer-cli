/**
 * @copyright Copyright 2016-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module openapi-transformer-cli
 */

import { Command } from 'commander';
// TODO [engine:node@>=14]: import { readFile } from 'fs/promises'
import { createReadStream } from 'fs';
import { load as loadYaml } from 'js-yaml';
import jsonReplaceExponentials from 'json-replace-exponentials';
import { createRequire } from 'module';
import path from 'path';
import { debuglog } from 'util';

const debug = debuglog('openapi-transformer-cli');

/** OpenAPI Transformer Name and Arguments
 *
 * The name or path of an OpenAPI Transformer module.  The name will be
 * resolved (using <a
 * href="https://nodejs.org/api/esm.html#esm_import_meta_resolve_specifier_parent"><code>import.meta.resolve()</code></a>
 * with fallback to <a
 * href="https://nodejs.org/api/modules.html#modules_require_resolve_request_options><code>require.resolve()</code></a>)
 * relative to the configuration file and <code>import()</code>ed.  The
 * default export (<code>module.exports</code> for CommonJS) will be called
 * using <code>new</code>.  <code>#transformOpenApi()</code> will be called
 * on the returned value with the document to transform as its only argument.
 * One way to satisfy the requirements is to create a module which
 * default-exports class that extends {@link openapi-transformer-base}.
 *
 * Alternatively, an Array can be used.  In this case, the first element of
 * the array is the name or path, as described above, and any subsequent
 * elements are passed to the constructor (e.g. options).
 *
 * @typedef {string|!Array} OpenapiTransformerNameArgs
 */

/** OpenAPI Transformer CLI Options
 *
 * @typedef {{
 *   transformers: !Array<!OpenapiTransformerNameArgs>=
 * }} OpenapiTransformerCliOptions
 * @property {!Array<OpenapiTransformerNameArgs>=} transformers Array of
 * OpenAPI Transformers to apply, in order of application.
 */

function readString(stream) {
  return new Promise((resolve, reject) => {
    let str = '';
    stream.on('data', (data) => {
      // Converting Buffer to string here could break multi-byte chars.
      // It's also inefficient.  Require callers to .setEncoding().
      if (typeof data !== 'string') {
        stream.destroy(new TypeError(
          `expected string, got ${typeof data} from stream`,
        ));
      }

      str += data;
    });
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

function makeResolver() {
  const { resolve } = createRequire(import.meta.url);
  return (id, parent) => resolve(
    id,
    parent ? { paths: [path.dirname(parent)] } : undefined,
  );
}

// FIXME: require.resolve() resolves differently from import.meta.resolve()
// in the presence of conditional exports
// https://nodejs.org/api/packages.html#packages_conditional_exports
// Could use resolve, if/when it supports package.json#exports:
// https://github.com/browserify/resolve/issues/222
// https://github.com/browserify/resolve/pull/224
const resolveTransformer = import.meta.resolve || makeResolver();

function createTransformersForConfig({ configFilePath, transformers }) {
  const resolveParent =
    configFilePath ? path.resolve(configFilePath) : undefined;
  return transformers.map(async (transformer) => {
    const [name, ...options] =
      Array.isArray(transformer) ? transformer : [transformer];
    const resolved = await resolveTransformer(name, resolveParent);
    // https://github.com/mysticatea/eslint-plugin-node/pull/256
    // eslint-disable-next-line node/no-unsupported-features/es-syntax
    const { default: Transformer } = await import(resolved);
    return new Transformer(...options);
  });
}

async function applyTransformers(configs, openApi) {
  const transformers =
    await Promise.all(configs.flatMap(createTransformersForConfig));

  for (const transformer of transformers) {
    // eslint-disable-next-line no-await-in-loop
    openApi = await transformer.transformOpenApi(openApi);
  }

  return openApi;
}

/** Option parser to count the number of occurrences of the option.
 *
 * @private
 * @param {boolean|string} optarg Argument passed to option (ignored).
 * @param {number=} previous Previous value of option (counter).
 * @returns {number} previous + 1.
 */
function countOption(optarg, previous) {
  return (previous || 0) + 1;
}

/** Write to a stream.Writable asynchronously.
 *
 * @private
 * @param {!stream.Writable} stream Stream to write to.
 * @param {*} chunk Value to write to stream.
 * @param {string} encoding Encoding in which to write chunk.
 * @returns {!Promise} Promise for write completion or error.
 */
function streamWrite(stream, chunk, encoding) {
  return new Promise((resolve, reject) => {
    // Note: write() callback not guaranteed on error.
    // Use error event to ensure errors are handled.
    stream.once('error', reject);
    stream.write(chunk, encoding, (err) => {
      if (!err) {
        resolve();
        stream.removeListener('error', reject);
      }
    });
  });
}

/** Options for command entry points.
 *
 * @typedef {{
 *   env: !object<string,string>,
 *   stdin: !module:stream.Readable,
 *   stdout: !module:stream.Writable,
 *   stderr: !module:stream.Writable
 * }} CommandOptions
 * @property {!object<string,string>} env Environment variables.
 * @property {!module:stream.Readable} stdin Stream from which input is read.
 * @property {!module:stream.Writable} stdout Stream to which output is
 * written.
 * @property {!module:stream.Writable} stderr Stream to which errors and
 * non-output status messages are written.
 */
// const CommandOptions;

/** Entry point for this command.
 *
 * @param {!Array<string>} args Command-line arguments.
 * @param {!CommandOptions} options Options.
 * @returns {!Promise<number>} Promise for exit code.  Only rejected for
 * arguments with invalid type (or args.length < 2).
 */
export default async function openapiTransformerMain(args, options) {
  if (!Array.isArray(args) || args.length < 2) {
    throw new TypeError('args must be an Array with at least 2 items');
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
    .option('-q, --quiet', 'Print less output', countOption)
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
    .option('-v, --verbose', 'Print more output', countOption)
    // TODO: Replace with .version(packageJson.version) loaded as JSON module
    // https://github.com/nodejs/node/issues/37141
    .option('-V, --version', 'output the version number');

  try {
    command.parse(args);
  } catch (errParse) {
    // Note: Error message already printed to stderr by Commander
    return errParse.exitCode !== undefined ? errParse.exitCode : 1;
  }

  const argOpts = command.opts();

  if (argOpts.version) {
    const packageJsonStream = createReadStream(
      new URL('package.json', import.meta.url),
      { encoding: 'utf8' },
    );
    const packageJson = await readJson(packageJsonStream);
    options.stdout.write(`${packageJson.version}\n`);
    return 0;
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

  try {
    const openApi = await readJsonOrYaml(openApiStream, onWarning);
    const configs = await Promise.all(configsOrPromises);
    const newOpenApi = await applyTransformers(configs, openApi);
    const json =
      jsonReplaceExponentials(JSON.stringify(newOpenApi, undefined, 2));
    await streamWrite(options.stdout, `${json}\n`);
    return 0;
  } catch (err) {
    options.stderr.write(`${err}\n`);
    return 1;
  }
}
