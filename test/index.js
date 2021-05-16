/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import assert, { AssertionError } from 'assert';
// TODO [engine:node@>=14]: import { readFile } from 'fs/promises'
import { promises as fsPromises } from 'fs';
import path from 'path';
import RelateUrl from 'relateurl';
import { PassThrough } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';

import main from '../index.js';

const { readFile } = fsPromises;

const sharedArgs = ['node', 'openapi-transformer'];
const asyncPathUrl =
  new URL('../test-root/lib/async-transformer.js', import.meta.url);
const openapiJsonPathUrl =
  new URL('../test-root/lib/openapi.json', import.meta.url);
const openapiJsonPath = fileURLToPath(openapiJsonPathUrl);
const openapiYamlPathUrl =
  new URL('../test-root/lib/openapi.yaml', import.meta.url);
const openapiYamlPath = fileURLToPath(openapiYamlPathUrl);
const syncPathUrl =
  new URL('../test-root/lib/sync-transformer.js', import.meta.url);

// TODO: Load as JSON module once natively supported
// https://github.com/nodejs/node/issues/37141
const openapiJsonPromise =
  readFile(openapiJsonPath, { encoding: 'utf8' })
    .then(JSON.parse);
const packageJsonPromise =
  readFile(new URL('../package.json', import.meta.url), { encoding: 'utf8' })
    .then(JSON.parse);

/** Convert a file: URL to a module specifier relative to process.cwd()
 *
 * @private
 * @param {string} moduleUrl Module file: URL, as a string.
 * @returns {string} Module specifier for moduleUrl relative to process.cwd().
 */
function toRelativeModSpec(moduleUrl) {
  const relUrl = RelateUrl.relate(
    `${pathToFileURL(process.cwd())}/`,
    moduleUrl,
    { output: RelateUrl.PATH_RELATIVE },
  );
  return relUrl[0] === '.' ? relUrl : `./${relUrl}`;
}

function getTestOptions() {
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough({ encoding: 'utf8' }),
    stderr: new PassThrough({ encoding: 'utf8' }),
  };
}

describe('openapi-transformer-cli', () => {
  let origCwd;
  before('chdir(test-root)', () => {
    origCwd = process.cwd();
    process.chdir(fileURLToPath(new URL('../test-root', import.meta.url)));
  });
  after('restore cwd', () => process.chdir(origCwd));

  it('rejects TypeError with no args', () => {
    return assert.rejects(
      () => main(),
      TypeError,
    );
  });

  it('rejects TypeError for non-Array Array-like first arg', () => {
    return assert.rejects(
      () => main({ 0: '', 1: '', length: 2 }, getTestOptions()),
      TypeError,
    );
  });

  it('rejects TypeError for non-Array iterable first arg', () => {
    // eslint-disable-next-line no-empty-function
    const iter = (function* () {}());
    return assert.rejects(
      () => main(iter, getTestOptions()),
      TypeError,
    );
  });

  it('rejects TypeError for Array with less than 2 items', () => {
    return assert.rejects(
      () => main(['node'], getTestOptions()),
      TypeError,
    );
  });

  it('rejects TypeError for non-Object second arg', () => {
    return assert.rejects(
      () => main(sharedArgs, 1),
      TypeError,
    );
  });

  it('rejects TypeError for missing stdin', () => {
    const options = getTestOptions();
    delete options.stdin;
    return assert.rejects(
      () => main(sharedArgs, options),
      TypeError,
    );
  });

  it('rejects TypeError for missing stdout', () => {
    const options = getTestOptions();
    delete options.stdout;
    return assert.rejects(
      () => main(sharedArgs, options),
      TypeError,
    );
  });

  it('rejects TypeError for missing stderr', () => {
    const options = getTestOptions();
    delete options.stderr;
    return assert.rejects(
      () => main(sharedArgs, options),
      TypeError,
    );
  });

  it('writes error and exit 1 for unexpected option', async () => {
    const options = getTestOptions();
    const code = await main([...sharedArgs, '--unexpected'], options);
    assert.strictEqual(code, 1);
    assert.strictEqual(options.stdout.read(), null);
    assert.strictEqual(
      options.stderr.read(),
      "error: unknown option '--unexpected'\n",
    );
  });

  it('writes error and exit 1 for unexpected args', async () => {
    const options = getTestOptions();
    const code = await main([...sharedArgs, 'arg1', 'arg2'], options);
    assert.strictEqual(code, 1);
    assert.strictEqual(options.stdout.read(), null);
    assert.strictEqual(
      options.stderr.read(),
      'error: too many arguments. Expected 1 argument but got 2.\n',
    );
  });

  for (const helpOption of ['-h', '--help']) {
    it(`writes usage to stdout with exit 0 for ${helpOption}`, async () => {
      const options = getTestOptions();
      const code = await main([...sharedArgs, helpOption], options);
      assert.strictEqual(code, 0);
      assert.strictEqual(
        options.stdout.read(),
        `Usage: openapi-transformer [options] [openapi_file]

Transform an OpenAPI document.

Options:
  -q, --quiet                 Print less output
  -t, --transformer <module>  transformer module to apply (repeatable)
  -v, --verbose               Print more output
  -V, --version               output the version number
  -h, --help                  display help for command
`,
      );
      assert.strictEqual(options.stderr.read(), null);
    });
  }

  for (const verOption of ['-V', '--version']) {
    it(`writes version to stdout then exit 0 for ${verOption}`, async () => {
      const packageJson = await packageJsonPromise;
      const options = getTestOptions();
      const code = await main([...sharedArgs, verOption], options);
      assert.strictEqual(code, 0);
      assert.strictEqual(
        options.stdout.read(),
        `${packageJson.version}\n`,
      );
      assert.strictEqual(options.stderr.read(), null);
    });
  }

  it('transforms JSON stdin to stdout by default', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code = await main(sharedArgs, options);
    assert.strictEqual(options.stderr.read(), null);
    assert.strictEqual(options.stdout.read(), '{}\n');
    assert.strictEqual(code, 0);
  });

  it('transforms JSON file to stdout', async () => {
    const options = getTestOptions();
    const code = await main([...sharedArgs, openapiJsonPath], options);
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      await openapiJsonPromise,
    );
    assert.strictEqual(code, 0);
  });

  it('transforms YAML stdin to stdout by default', async () => {
    const options = getTestOptions();
    options.stdin.end('openapi: "3.0.2"');
    const code = await main(sharedArgs, options);
    assert.strictEqual(options.stderr.read(), null);
    assert.strictEqual(options.stdout.read(), '{\n  "openapi": "3.0.2"\n}\n');
    assert.strictEqual(code, 0);
  });

  it('transforms YAML file to stdout', async () => {
    const options = getTestOptions();
    const code = await main([...sharedArgs, openapiYamlPath], options);
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      await openapiJsonPromise,
    );
    assert.strictEqual(code, 0);
  });

  it('transforms stdin split across multiple reads', async () => {
    const options = getTestOptions();
    options.stdin.write('{');
    setTimeout(
      () => options.stdin.end('}'),
      10,
    );
    const code = await main(sharedArgs, options);
    assert.strictEqual(options.stderr.read(), null);
    assert.strictEqual(options.stdout.read(), '{}\n');
    assert.strictEqual(code, 0);
  });

  it('prints error for invalid JSON/YAML', async () => {
    const options = getTestOptions();
    options.stdin.end('{');
    const code = await main(sharedArgs, options);
    assert.match(options.stderr.read(), /^YAMLException: /);
    assert.strictEqual(options.stdout.read(), null);
    assert.strictEqual(code, 1);
  });

  it('warns when reading from TTY by default', async () => {
    const options = getTestOptions();
    options.stdin.isTTY = true;
    options.stdin.end('{}');
    const code = await main(sharedArgs, options);
    assert.strictEqual(
      options.stderr.read(),
      'Warning: No filename given.  Will read from stdin...\n',
    );
    assert.strictEqual(options.stdout.read(), '{}\n');
    assert.strictEqual(code, 0);
  });

  it('does not warn for explicit stdin TTY', async () => {
    const options = getTestOptions();
    options.stdin.isTTY = true;
    options.stdin.end('{}');
    const code = await main([...sharedArgs, '-'], options);
    assert.strictEqual(options.stderr.read(), null);
    assert.strictEqual(options.stdout.read(), '{}\n');
    assert.strictEqual(code, 0);
  });

  it('--transformer for sync with file: URL', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code =
      await main([...sharedArgs, '--transformer', syncPathUrl.href], options);
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      {
        'x-transformers': [
          ['sync-transformer'],
        ],
      },
    );
    assert.strictEqual(code, 0);
  });

  it('--transformer for sync with relative specifier', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code = await main(
      [...sharedArgs, '--transformer', toRelativeModSpec(syncPathUrl.href)],
      options,
    );
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      {
        'x-transformers': [
          ['sync-transformer'],
        ],
      },
    );
    assert.strictEqual(code, 0);
  });

  // This works with require.resolve everywhere.
  // With import.meta.resolve() it works on Unix-likes and fails on Windows:
  // Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only file and data URLs are
  // supported by the default ESM loader. On Windows, absolute paths must be
  // valid file:// URLs. Received protocol 'c:'
  //
  // Difficult to test.  Skip for now.
  xit('--transformer with absolute path behaves like resolve()', async () => {
    // TODO
  });

  it('--transformer with relative path (non-specifier) fails', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const syncRelPath =
      path.relative(process.cwd(), fileURLToPath(syncPathUrl));
    const code = await main(
      [...sharedArgs, '--transformer', syncRelPath],
      options,
    );
    const stderrStr = options.stderr.read();
    const prefixes = [
      // require.resolve
      `Error: Cannot find module '${syncRelPath}'`,
      // import.meta.resolve
      `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '${
        syncRelPath.split('/')[0]}'`,
      // import.meta.resolve on Windows
      `TypeError [ERR_INVALID_MODULE_SPECIFIER]: Invalid module "${
        syncRelPath}" is not a valid package name`,
    ];
    assert(stderrStr, 'Expected stderr to not be empty');
    if (!prefixes.some((prefix) => stderrStr.startsWith(prefix))) {
      throw new AssertionError({
        message: 'Expected stderr to start with a known error message',
        actual: stderrStr,
        // Note: Must be same type as actual for mocha to show diff
        expected: prefixes.join('\n'),
        operator: 'startsWith',
      });
    }
    assert.strictEqual(options.stdout.read(), null);
    assert.strictEqual(code, 1);
  });

  it('--transformer for async with file: URL', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code =
      await main([...sharedArgs, '--transformer', asyncPathUrl.href], options);
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      {
        'x-transformers': [
          ['async-transformer'],
        ],
      },
    );
    assert.strictEqual(code, 0);
  });

  it('--transformer for async with relative specifier', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code = await main(
      [...sharedArgs, '--transformer', toRelativeModSpec(asyncPathUrl.href)],
      options,
    );
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      {
        'x-transformers': [
          ['async-transformer'],
        ],
      },
    );
    assert.strictEqual(code, 0);
  });

  it('can combine multiple --transformer', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code = await main(
      [
        ...sharedArgs,
        '--transformer',
        syncPathUrl.href,
        '--transformer',
        asyncPathUrl.href,
      ],
      options,
    );
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      {
        'x-transformers': [
          ['sync-transformer'],
          ['async-transformer'],
        ],
      },
    );
    assert.strictEqual(code, 0);
  });
});
