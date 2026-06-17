module.exports = {
  displayName: "Decaf Integrations",
  verbose: true,
  transform: { "^.+\\.ts?$": "ts-jest", },
  testEnvironment: "node",
  testRegex: "/tests/.*\\.(test|spec)\\.(ts|tsx)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node",],
  collectCoverage: true,
  coverageDirectory: "./workdocs/coverage",
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts",],
  coverageReporters: ["json-summary", "text-summary", "text", "html",],
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
};
