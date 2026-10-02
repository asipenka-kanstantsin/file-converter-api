// Runs the TypeScript render child when the app runs from source (the e2e tests); the built app
// forks the compiled svg-render.child.js instead. Transpile only, with its own minimal options.
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
require('./svg-render.child.ts');
