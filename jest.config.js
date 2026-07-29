module.exports = {
  testEnvironment: 'node',
  testMatch:       ['<rootDir>/pkg/pve/**/*.test.ts'],
  transform:       {
    '^.+\\.ts$': ['babel-jest', { configFile: require.resolve('./jest.babel.config.js') }],
  },
  // Built extension copies contain duplicate package.json files that jest's
  // module map warns about; they are not sources.
  modulePathIgnorePatterns: ['<rootDir>/dist-pkg/', '<rootDir>/extensions/'],
};
