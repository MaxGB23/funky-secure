import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

/** The identity every report carries (RFC 10.2). Read once, from the package manifest. */
export const TOOL = Object.freeze({ name: pkg.name, version: pkg.version });
