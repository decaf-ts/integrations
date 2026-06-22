/* eslint-disable no-undef */
module.exports = {
  displayName: "Decaf Integrations",
  verbose: true,
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
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverage: true,
  coverageDirectory: "./workdocs/coverage",
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}", 
    "!src/**/*.d.ts",
  ],
  coverageReporters: ["json-summary", "text-summary", "text", "html"],
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "./workdocs/coverage",
        outputName: "junit-report.xml",
      },
    ],
  ],
  watchman: false,
  moduleNameMapper: {
    "^\\.\\.\\/\\.\\.\\/lib\\/keycloak(.*)$": "<rootDir>/../integrations/src/keycloak\\1",
  },
  extensionsToTreatAsEsm: [".ts"],
  preset: "ts-jest/presets/default-esm",
  testMatch: ["**/tests/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/lib/"],
  testTimeout: 30000,
};
