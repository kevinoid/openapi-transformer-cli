/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const assert = require('assert');
const { PassThrough } = require('stream');

const main = require('../index.js');
const packageJson = require('../package.json');

const sharedArgs = ['node', 'openapi-transformer'];

function getTestOptions() {
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough({ encoding: 'utf8' }),
    stderr: new PassThrough({ encoding: 'utf8' }),
  };
}

function neverCalled() {
  assert.fail('Should not be called');
}

describe('openapi-transformer-cli', () => {
  it('throws TypeError with no args', () => {
    assert.throws(
      () => main(),
      TypeError,
    );
  });

  it('throws TypeError for non-Array first arg', () => {
    assert.throws(
      () => main({}, getTestOptions(), neverCalled),
      TypeError,
    );
  });

  it('throws TypeError for non-Object second arg', () => {
    assert.throws(
      () => main(sharedArgs, 1, neverCalled),
      TypeError,
    );
  });

  it('throws TypeError for missing stdin', () => {
    const options = getTestOptions();
    delete options.stdin;
    assert.throws(
      () => main(sharedArgs, options, neverCalled),
      TypeError,
    );
  });

  it('throws TypeError for missing stdout', () => {
    const options = getTestOptions();
    delete options.stdout;
    assert.throws(
      () => main(sharedArgs, options, neverCalled),
      TypeError,
    );
  });

  it('throws TypeError for missing stderr', () => {
    const options = getTestOptions();
    delete options.stderr;
    assert.throws(
      () => main(sharedArgs, options, neverCalled),
      TypeError,
    );
  });

  it('throws TypeError for non-function callback', () => {
    assert.throws(
      () => main(sharedArgs, getTestOptions(), {}),
      TypeError,
    );
  });

  it('writes error and exit 1 for unexpected args', (done) => {
    const options = getTestOptions();
    const result = main([...sharedArgs, 'arg1', 'arg2'], options, (code) => {
      assert.strictEqual(code, 1);
      assert.strictEqual(options.stdout.read(), null);
      assert.strictEqual(
        options.stderr.read(),
        'error: too many arguments. Expected 1 argument but got 2.\n',
      );
      done();
    });
    assert.strictEqual(result, undefined);
  });

  it('writes usage and exit 0 for --help', (done) => {
    const options = getTestOptions();
    const result = main([...sharedArgs, '--help'], options, (code) => {
      assert.strictEqual(code, 0);
      assert.strictEqual(
        options.stdout.read(),
        `Usage: openapi-transformer [options] [openapi_file]

Transform an OpenAPI document.

Options:
  -c, --config <file>         JSON configuration file
  -t, --transformer <module>  transformer module to apply (repeatable)
                              (default: [])
  -V, --version               output the version number
  -h, --help                  display help for command
`,
      );
      assert.strictEqual(options.stderr.read(), null);
      done();
    });
    assert.strictEqual(result, undefined);
  });

  it('writes version and exit 0 for --version', (done) => {
    const options = getTestOptions();
    const result = main([...sharedArgs, '--version'], options, (code) => {
      assert.strictEqual(code, 0);
      assert.strictEqual(
        options.stdout.read(),
        `${packageJson.version}\n`,
      );
      assert.strictEqual(options.stderr.read(), null);
      done();
    });
    assert.strictEqual(result, undefined);
  });

  it('transforms JSON stdin to stdout by default', (done) => {
    const options = getTestOptions();
    const result = main(sharedArgs, options, (code) => {
      assert.strictEqual(options.stderr.read(), null);
      assert.strictEqual(options.stdout.read(), '{}\n');
      assert.strictEqual(code, 0);
      done();
    });
    assert.strictEqual(result, undefined);
    options.stdin.end('{}');
  });

  it('transforms YAML stdin to stdout by default', (done) => {
    const options = getTestOptions();
    const result = main(sharedArgs, options, (code) => {
      assert.strictEqual(options.stderr.read(), null);
      assert.strictEqual(options.stdout.read(), '{\n  "openapi": "3.0.2"\n}\n');
      assert.strictEqual(code, 0);
      done();
    });
    assert.strictEqual(result, undefined);
    options.stdin.end('openapi: "3.0.2"');
  });

  it('transforms stdin split across multiple reads', (done) => {
    const options = getTestOptions();
    const result = main(sharedArgs, options, (code) => {
      assert.strictEqual(options.stderr.read(), null);
      assert.strictEqual(options.stdout.read(), '{}\n');
      assert.strictEqual(code, 0);
      done();
    });
    assert.strictEqual(result, undefined);
    options.stdin.write('{');
    setTimeout(
      () => options.stdin.end('}'),
      10,
    );
  });

  it('prints error for invalid JSON/YAML', (done) => {
    const options = getTestOptions();
    const result = main(sharedArgs, options, (code) => {
      assert.match(options.stderr.read(), /^YAMLException: /);
      assert.strictEqual(options.stdout.read(), null);
      assert.strictEqual(code, 1);
      done();
    });
    assert.strictEqual(result, undefined);
    options.stdin.end('{');
  });

  it('warns when reading from TTY by default', (done) => {
    const options = getTestOptions();
    options.stdin.isTTY = true;
    const result = main(sharedArgs, options, (code) => {
      assert.strictEqual(
        options.stderr.read(),
        'Warning: No filename given.  Will read from stdin...\n',
      );
      assert.strictEqual(options.stdout.read(), '{}\n');
      assert.strictEqual(code, 0);
      done();
    });
    assert.strictEqual(result, undefined);
    options.stdin.end('{}');
  });

  it('does not warn for explicit stdin TTY', (done) => {
    const options = getTestOptions();
    options.stdin.isTTY = true;
    const result = main([...sharedArgs, '-'], options, (code) => {
      assert.strictEqual(options.stderr.read(), null);
      assert.strictEqual(options.stdout.read(), '{}\n');
      assert.strictEqual(code, 0);
      done();
    });
    assert.strictEqual(result, undefined);
    options.stdin.end('{}');
  });
});