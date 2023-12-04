module.exports = {
    preset: 'ts-jest',
    transform: {
      '^.+\\.(ts|tsx)?$': 'ts-jest',
      '^.+\\.(js|jsx)$': 'babel-jest',
    },
    moduleNameMapper: {
      '^@fullcircle/harness/(.*)$': '<rootDir>/../../packages/harness/src/$1',
    },
  };
