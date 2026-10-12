// Loads the TypeScript worker when the app runs from source (the e2e tests): the built app uses
// the compiled conversion.worker.js instead. Transpile only, with its own minimal options:
// the worker has no path aliases and needs nothing from the project's tsconfig.
require('ts-node').register({
  compilerOptions: {
    esModuleInterop: true,
    module: 'commonjs',
    moduleResolution: 'node10',
    target: 'ES2022',
  },
  skipProject: true,
  transpileOnly: true,
});
module.exports = require('./conversion.worker.ts');
