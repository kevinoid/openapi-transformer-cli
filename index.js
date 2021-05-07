/**
 * @copyright Copyright 2017-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module modulename/cli.js
 */

import { Command } from 'commander';
// TODO [engine:node@>=14]: import { readFile } from 'fs/promises'
import { promises as fsPromises } from 'fs';

import { modulenameMockSymbol } from './lib/symbols.js';

const { readFile } = fsPromises;

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

async function readJson(pathOrUrl, options) {
  const content = await readFile(pathOrUrl, { encoding: 'utf8', ...options });
  return JSON.parse(content);
}

async function modulename() {
  // Do real work here
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
export default async function modulenameMain(args, options) {
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

  const command = new Command()
    .exitOverride()
    .configureOutput({
      writeOut: (str) => options.stdout.write(str),
      writeErr: (str) => options.stderr.write(str),
      getOutHelpWidth: () => options.stdout.columns,
      getErrHelpWidth: () => options.stderr.columns,
    })
    .arguments('[file...]')
    .allowExcessArguments(false)
    // Check for required/excess arguments.
    // Workaround https://github.com/tj/commander.js/issues/1493
    .action(() => {})
    .description('Command description.')
    .option('-q, --quiet', 'Print less output', countOption)
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
    const packageJson =
      await readJson(new URL('package.json', import.meta.url));
    options.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  const cmdOpts = {
    files: command.args,
    verbosity: (argOpts.verbose || 0) - (argOpts.quiet || 0),
  };
  const modulenameOrMock = options[modulenameMockSymbol] || modulename;
  try {
    await modulenameOrMock(cmdOpts);
    return 0;
  } catch (err) {
    options.stderr.write(`${err}\n`);
    return 1;
  }
}
