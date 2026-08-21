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
  testPathIgnorePatterns: [
    "/node_modules/",
    "/tests/e2e/plugins/.*\\.e2e\\.test\\.ts$",
  ],
  transformIgnorePatterns: ["node_modules/(?!(jose|uuid)/)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  coverageDirectory: "./workdocs/reports/coverage",
  collectCoverage: false,
  collectCoverageFrom: ["src/**/*.{js,jsx,ts,tsx}", "!src/bin/**/*.ts"],
  reporters: ["default"],
  moduleNameMapper: {
    "^\\.\\.\\/\\.\\.\\/lib\\/keycloak(.*)$":
      "<rootDir>/../integrations/src/keycloak\\1",
    "^@decaf-ts/for-nest$": "<rootDir>/../for-nest/lib/esm/index.js",
    "^@decaf-ts/for-http/hooks$": "<rootDir>/../for-http/lib/cjs/server/hooks/index.cjs",
    "^@decaf-ts/for-http/server$": "<rootDir>/../for-http/lib/cjs/server/index.cjs",
    "^@decaf-ts/for-http$": "<rootDir>/../for-http/lib/cjs/index.cjs",
    "^@nestjs/core(/.*)?$": "<rootDir>/../for-nest/node_modules/@nestjs/core$1",
    "^@nestjs/common(/.*)?$": "<rootDir>/../for-nest/node_modules/@nestjs/common$1",
    "^@nestjs/swagger(/.*)?$": "<rootDir>/../for-nest/node_modules/@nestjs/swagger$1",
    "^@nestjs/mapped-types(/.*)?$": "<rootDir>/../for-nest/node_modules/@nestjs/mapped-types$1",
    "^@nestjs/platform-express(/.*)?$": "<rootDir>/../for-nest/node_modules/@nestjs/platform-express$1",
    "^@nestjs/testing(/.*)?$": "<rootDir>/../for-nest/node_modules/@nestjs/testing$1",
  },
  extensionsToTreatAsEsm: [".ts"],
  preset: "ts-jest/presets/default-esm",
};

// eslint-disable-next-line no-undef
module.exports = config;
