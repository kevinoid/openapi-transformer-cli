#!/usr/bin/env node
/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import main from '../index.js';

process.exitCode = await main(process.argv, process);
