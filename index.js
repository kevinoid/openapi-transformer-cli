/**
 * @copyright Copyright 2016-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module openapi-transformer-cli
 */

import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { debuglog } from 'node:util';

import { Command } from 'commander';
import { load as loadYaml } from 'js-yaml';
import jsonReplaceExponentials from 'json-replace-exponentials';

const debug = debuglog('openapi-transformer-cli');

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

function makeResolver() {
  const { resolve } = createRequire(import.meta.url);
  return (id, parent) => pathToFileURL(resolve(
    id.startsWith('file:') ? fileURLToPath(id) : id,
    parent ? { paths: [path.dirname(fileURLToPath(parent))] } : undefined,
  )).href;
}

// FIXME: require.resolve() resolves differently from import.meta.resolve()
// in the presence of conditional exports
// https://nodejs.org/api/packages.html#packages_conditional_exports
// Could use resolve, if/when it supports package.json#exports:
// https://github.com/browserify/resolve/issues/222
// https://github.com/browserify/resolve/pull/224
//
// import.meta.resolve() was unflagged without the parentURL argument in
// Node.js 20.6.0: https://github.com/nodejs/node/pull/49028
// TODO[engine:node@>=22]: Use import.meta.resolve if it supports parentURL
const resolveTransformer = makeResolver();

async function loadTransformer(name, parent) {
  const resolved = await resolveTransformer(name, parent);
  debug('resolved transformer %s to %s', name);
  const { default: Transformer } = await import(resolved);
  return new Transformer();
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
 *   env: !Object<string,string>,
 *   stdin: !module:stream.Readable,
 *   stdout: !module:stream.Writable,
 *   stderr: !module:stream.Writable
 * }} CommandOptions
 * @property {!Object<string,string>} env Environment variables.
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

  let errVersion;
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
    .description('Transform an OpenAPI document.')
    .option('-q, --quiet', 'print less output', countOption)
    .option(
      '-t, --transformer <module>',
      'transformer module to apply (repeatable)',
      (value, values) => (values ? [...values, value] : [value]),
    )
    .option('-v, --verbose', 'print more output', countOption)
    // TODO: .version(packageJson.version) from JSON import
    // Requires Node.js ^16.14 || >=17.5:
    // https://github.com/nodejs/node/pull/41736
    // https://nodejs.org/api/esm.html#json-modules
    // Won't be supported by ESLint until proposal reaches Stage 4:
    // https://github.com/eslint/eslint/issues/15623
    // https://github.com/tc39/proposal-import-attributes
    .option('-V, --version', 'output the version number')
    // throw exception to stop option parsing early, as commander does
    // (e.g. to avoid failing due to missing required arguments)
    .on('option:version', () => {
      errVersion = new Error('version');
      throw errVersion;
    });

  try {
    command.parse(args);
  } catch (errParse) {
    if (errVersion) {
      const packageJsonStream = createReadStream(
        new URL('package.json', import.meta.url),
        { encoding: 'utf8' },
      );
      const packageJson = await readJson(packageJsonStream);
      options.stdout.write(`${packageJson.version}\n`);
      return 0;
    }

    // Note: Error message already printed to stderr by Commander
    return errParse.exitCode !== undefined ? errParse.exitCode : 1;
  }

  const argOpts = command.opts();

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
    // Begin loading all transformers early
    // Note: To resolve from cwd, use parent file: URL of (dummy) file in cwd
    const cwdUrl = pathToFileURL(path.resolve('dummy.js')).href;
    const transformerPs = (argOpts.transformer || [])
      .map((t) => loadTransformer(t, cwdUrl));
    // Suppress unhandledrejection, which is handled when applied
    for (const transformerP of transformerPs) {
      transformerP.catch(() => {});
    }

    let openApi = await readJsonOrYaml(openApiStream, onWarning);
    for (const [i, transformerP] of Object.entries(transformerPs)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const transformer = await transformerP;
        // eslint-disable-next-line no-await-in-loop
        openApi = await transformer.transformOpenApi(openApi);
      } catch (errTransformer) {
        errTransformer.message +=
          ` applying transformer ${argOpts.transformer[i]}`;
        throw errTransformer;
      }
    }

    const json =
      jsonReplaceExponentials(JSON.stringify(openApi, undefined, 2));
    await streamWrite(options.stdout, `${json}\n`);
    return 0;
  } catch (err) {
    options.stderr.write(`${err.stack}\n`);
    return 1;
  }
}
