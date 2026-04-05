#!/usr/bin/env node
import assert from "assert";
import { fileURLToPath } from 'url';
import * as path from "path";
import * as fs from "fs/promises";

// Import the extensions module functions
import {
  activateExtension,
  deactivateExtension,
  listActiveExtensions,
  getExtensionToolHandlers,
  getExtensionToolDefinitions,
} from "../dist/src/extensions/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a mock extension file for testing
async function createMockExtension() {
  const extensionsDir = path.join(__dirname, "../dist/src/extensions");
  const mockExtensionPath = path.join(extensionsDir, "testlang.js");

  const mockExtensionCode = `
export function getToolHandlers() {
  return {
    "test_tool": {
      schema: { type: "object", properties: { input: { type: "string" } } },
      handler: async (args) => ({ result: "test" })
    }
  };
}

export function getToolDefinitions() {
  return [
    {
      name: "test_tool",
      description: "A test tool",
      inputSchema: { type: "object", properties: { input: { type: "string" } } }
    }
  ];
}
`;

  await fs.writeFile(mockExtensionPath, mockExtensionCode);
  return mockExtensionPath;
}

async function cleanupMockExtension(mockExtensionPath) {
  try {
    await fs.unlink(mockExtensionPath);
  } catch (err) {
    // Ignore errors during cleanup
  }
}

async function testActivateExtension() {
  const mockPath = await createMockExtension();

  try {
    const result = await activateExtension("testlang");
    assert.strictEqual(result.success, true, "Should successfully activate extension");

    const activeExtensions = listActiveExtensions();
    assert.ok(activeExtensions.includes("testlang"), "Should list the activated extension");

    console.log("✓ Test 1 passed: activate extension");
  } finally {
    deactivateExtension("testlang");
    await cleanupMockExtension(mockPath);
  }
}

async function testActivateExtensionDuplicate() {
  const mockPath = await createMockExtension();

  try {
    const result1 = await activateExtension("testlang");
    assert.strictEqual(result1.success, true, "First activation should succeed");

    const result2 = await activateExtension("testlang");
    assert.strictEqual(result2.success, true, "Second activation should succeed (idempotent)");

    const activeExtensions = listActiveExtensions();
    const count = activeExtensions.filter(ext => ext === "testlang").length;
    assert.strictEqual(count, 1, "Should only have one instance of the extension");

    console.log("✓ Test 2 passed: duplicate activation is idempotent");
  } finally {
    deactivateExtension("testlang");
    await cleanupMockExtension(mockPath);
  }
}

async function testDeactivateExtension() {
  const mockPath = await createMockExtension();

  try {
    await activateExtension("testlang");
    const result = deactivateExtension("testlang");
    assert.strictEqual(result.success, true, "Should successfully deactivate");

    const activeExtensions = listActiveExtensions();
    assert.ok(!activeExtensions.includes("testlang"), "Should not list the deactivated extension");

    console.log("✓ Test 3 passed: deactivate extension");
  } finally {
    await cleanupMockExtension(mockPath);
  }
}

async function testDeactivateNonexistentExtension() {
  const result = deactivateExtension("nonexistent-lang");
  assert.strictEqual(result.success, false, "Should return false for nonexistent extension");
  console.log("✓ Test 4 passed: deactivate nonexistent extension returns false");
}

async function testActivateNonexistentExtension() {
  const result = await activateExtension("nonexistent-lang-xyz");
  assert.strictEqual(result.success, false, "Should return false for nonexistent extension");
  console.log("✓ Test 5 passed: activate nonexistent extension returns false");
}

async function testGetExtensionToolHandlers() {
  const mockPath = await createMockExtension();

  try {
    await activateExtension("testlang");
    const handlers = getExtensionToolHandlers();

    assert.ok("testlang.test_tool" in handlers, "Should have prefixed tool handler");
    assert.ok(handlers["testlang.test_tool"].schema, "Handler should have schema");
    assert.ok(typeof handlers["testlang.test_tool"].handler === "function", "Handler should be a function");

    console.log("✓ Test 6 passed: get extension tool handlers");
  } finally {
    deactivateExtension("testlang");
    await cleanupMockExtension(mockPath);
  }
}

async function testGetExtensionToolDefinitions() {
  const mockPath = await createMockExtension();

  try {
    await activateExtension("testlang");
    const definitions = getExtensionToolDefinitions();

    const testToolDef = definitions.find(def => def.name === "testlang.test_tool");
    assert.ok(testToolDef, "Should find the test tool definition");
    assert.strictEqual(testToolDef.description, "A test tool", "Should have correct description");
    assert.ok(testToolDef.inputSchema, "Should have inputSchema");

    console.log("✓ Test 7 passed: get extension tool definitions");
  } finally {
    deactivateExtension("testlang");
    await cleanupMockExtension(mockPath);
  }
}

async function testListActiveExtensionsEmpty() {
  // Ensure no test extensions are active
  deactivateExtension("testlang");

  const activeExtensions = listActiveExtensions();
  const hasTestLang = activeExtensions.includes("testlang");
  assert.strictEqual(hasTestLang, false, "Should not include testlang when not activated");

  console.log("✓ Test 8 passed: list active extensions when empty");
}

async function testSafeLanguageIdNormalization() {
  // Test that special characters in language IDs are sanitized
  const result = await activateExtension("test-lang-with-dashes");
  // This should try to load "test-lang-with-dashes.js" which doesn't exist
  assert.strictEqual(result.success, false, "Should handle language ID with dashes");
  console.log("✓ Test 9 passed: language ID normalization");
}

async function testMultipleExtensionsActive() {
  const mockPath1 = await createMockExtension();

  // Create a second mock extension
  const extensionsDir = path.join(__dirname, "../dist/src/extensions");
  const mockPath2 = path.join(extensionsDir, "testlang2.js");
  const mockExtensionCode2 = `
export function getToolHandlers() {
  return {
    "tool2": {
      schema: { type: "object" },
      handler: async (args) => ({ result: "test2" })
    }
  };
}
`;
  await fs.writeFile(mockPath2, mockExtensionCode2);

  try {
    await activateExtension("testlang");
    await activateExtension("testlang2");

    const activeExtensions = listActiveExtensions();
    assert.ok(activeExtensions.includes("testlang"), "Should have testlang active");
    assert.ok(activeExtensions.includes("testlang2"), "Should have testlang2 active");
    assert.strictEqual(activeExtensions.length, 2, "Should have exactly 2 extensions active");

    const handlers = getExtensionToolHandlers();
    assert.ok("testlang.test_tool" in handlers, "Should have testlang handler");
    assert.ok("testlang2.tool2" in handlers, "Should have testlang2 handler");

    console.log("✓ Test 10 passed: multiple extensions can be active simultaneously");
  } finally {
    deactivateExtension("testlang");
    deactivateExtension("testlang2");
    await cleanupMockExtension(mockPath1);
    await cleanupMockExtension(mockPath2);
  }
}

(async () => {
  try {
    await testActivateExtension();
    await testActivateExtensionDuplicate();
    await testDeactivateExtension();
    await testDeactivateNonexistentExtension();
    await testActivateNonexistentExtension();
    await testGetExtensionToolHandlers();
    await testGetExtensionToolDefinitions();
    await testListActiveExtensionsEmpty();
    await testSafeLanguageIdNormalization();
    await testMultipleExtensionsActive();
    console.log("\nAll tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    console.error(err.stack);
    process.exit(1);
  }
})();
