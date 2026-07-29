// Standalone babel config for jest only. The root babel.config.js requires
// ./.shell/pkg/babel.config.js, which @rancher/shell generates at build time
// and is absent in a clean checkout.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
};
