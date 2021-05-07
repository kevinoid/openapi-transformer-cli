/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import assert from 'assert';
// TODO [engine:node@>=14]: import { readFile } from 'fs/promises'
import { promises as fsPromises } from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import { fileURLToPath } from 'url';

import main from '../index.js';

const { readFile } = fsPromises;

const sharedArgs = ['node', 'openapi-transformer'];
const asyncPath =
  fileURLToPath(new URL('../test-lib/async-transformer.js', import.meta.url));
const configPath =
  fileURLToPath(new URL('../test-lib/config.json', import.meta.url));
const openapiJsonPath =
  fileURLToPath(new URL('../test-lib/openapi.json', import.meta.url));
const openapiYamlPath =
  fileURLToPath(new URL('../test-lib/openapi.yaml', import.meta.url));
const syncPath =
  fileURLToPath(new URL('../test-lib/sync-transformer.js', import.meta.url));

// TODO: Load as JSON module once natively supported
// https://github.com/nodejs/node/issues/37141
const openapiJsonPromise =
  readFile(openapiJsonPath, { encoding: 'utf8' })
    .then(JSON.parse);
const packageJsonPromise =
  readFile(new URL('../package.json', import.meta.url), { encoding: 'utf8' })
    .then(JSON.parse);

function getTestOptions() {
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough({ encoding: 'utf8' }),
    stderr: new PassThrough({ encoding: 'utf8' }),
  };
}

describe('openapi-transformer-cli', () => {
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
  -c, --config <file>         JSON configuration file
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

  it('--transformer for sync with absolute path', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code =
      await main([...sharedArgs, '--transformer', syncPath], options);
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

  it('--transformer for sync with relative path', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const syncRelPath = path.relative(process.cwd(), syncPath);
    const code = await main(
      [...sharedArgs, '--transformer', `.${path.sep}${syncRelPath}`],
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

  it('--transformer for async with absolute path', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code =
      await main([...sharedArgs, '--transformer', asyncPath], options);
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

  it('--transformer for async with relative path', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const asyncRelPath = path.relative(process.cwd(), asyncPath);
    const code = await main(
      [...sharedArgs, '--transformer', `.${path.sep}${asyncRelPath}`],
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
      [...sharedArgs, '--transformer', syncPath, '--transformer', asyncPath],
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

  it('--config with absolute path', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const code = await main(
      [...sharedArgs, '--config', configPath],
      options,
    );
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      {
        'x-transformers': [
          ['sync-transformer'],
          ['async-transformer', 'asyncArg'],
          ['sync-transformer', 'syncArg'],
        ],
      },
    );
    assert.strictEqual(code, 0);
  });

  it('--config with relative path', async () => {
    const options = getTestOptions();
    options.stdin.end('{}');
    const configRelPath = path.relative(process.cwd(), configPath);
    const code =
      await main([...sharedArgs, '--config', configRelPath], options);
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      {
        'x-transformers': [
          ['sync-transformer'],
          ['async-transformer', 'asyncArg'],
          ['sync-transformer', 'syncArg'],
        ],
      },
    );
    assert.strictEqual(code, 0);
  });

  it('--config from stdin', async () => {
    const options = getTestOptions();
    options.stdin.end(JSON.stringify({
      transformers: [
        syncPath,
        [asyncPath, 'asyncArg'],
        [syncPath, 'syncArg'],
      ],
    }));
    const code =
      await main([...sharedArgs, '--config', '-', openapiJsonPath], options);
    assert.strictEqual(options.stderr.read(), null);
    assert.deepStrictEqual(
      JSON.parse(options.stdout.read()),
      {
        ...await openapiJsonPromise,
        'x-transformers': [
          ['sync-transformer'],
          ['async-transformer', 'asyncArg'],
          ['sync-transformer', 'syncArg'],
        ],
      },
    );
    assert.strictEqual(code, 0);
  });
});
