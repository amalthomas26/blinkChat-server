module.exports = {
  // Two separate project configurations so pure unit tests never
  // pay the cost of spinning up MongoMemoryServer.
  projects: [
    {
      // ── Integration tests: need a real in-memory MongoDB ─────────────────
      displayName: "integration",
      testEnvironment: "node",
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
      transform: { "^.+\\.ts$": ["ts-jest", {}] },
      // Exclude the known pure-unit test files from this project
      testPathIgnorePatterns: [
        "/node_modules/",
        "src/tests/config/env.test.ts",
        "src/tests/message/message.controller.test.ts",
        "src/tests/socket/call.handler.test.ts",
        "src/tests/socket/service/call.service.test.ts",
      ],
      testMatch: ["**/tests/**/*.test.ts"],
      testTimeout: 30000,
    },
    {
      // ── Pure unit tests: fully mocked, no MongoDB needed ─────────────────
      displayName: "unit",
      testEnvironment: "node",
      // No setupFilesAfterFramework — skips jest.setup.ts entirely
      transform: { "^.+\\.ts$": ["ts-jest", {}] },
      testMatch: [
        "**/tests/config/env.test.ts",
        "**/tests/message/message.controller.test.ts",
        "**/tests/socket/call.handler.test.ts",
        "**/tests/socket/service/call.service.test.ts",
      ],
      testTimeout: 10000,
    },
  ],
};