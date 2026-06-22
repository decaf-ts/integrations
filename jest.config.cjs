const config = {
  verbose: true,
  // eslint-disable-next-line no-undef
  rootDir: __dirname,
  testEnvironment: "node",
  transform: {
    "^.+\\.ts?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          module: "esnext",
          moduleResolution: "node",
          resolveJsonModule: true,
        },
      },
    ],
  },
  testRegex: "/tests/.*\\.(test|spec)\\.(ts|tsx)$",
  transformIgnorePatterns: ["node_modules/(uuid)/.*"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  coverageDirectory: "./workdocs/reports/coverage",
  collectCoverage: false,
  collectCoverageFrom: ["src/**/*.{js,jsx,ts,tsx}", "!src/bin/**/*.ts"],
  reporters: ["default"],
  moduleNameMapper: {
    "^\\.\\.\\/\\.\\.\\/lib\\/keycloak(.*)$":
      "<rootDir>/../integrations/src/keycloak\\1",
  },
  extensionsToTreatAsEsm: [".ts"],
  preset: "ts-jest/presets/default-esm",
};

// eslint-disable-next-line no-undef
module.exports = config;
