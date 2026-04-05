#!/usr/bin/env node
import assert from "assert";
import * as path from "path";
import { createFileUri, checkLspClientInitialized } from "../dist/src/tools/index.js";

async function testCreateFileUriAbsolutePath() {
  const absolutePath = "/Users/test/project/file.ts";
  const uri = createFileUri(absolutePath);

  assert.strictEqual(uri, `file://${absolutePath}`, "Should create URI from absolute path");
  console.log("✓ Test 1 passed: createFileUri with absolute path");
}

async function testCreateFileUriRelativePath() {
  const relativePath = "src/file.ts";
  const uri = createFileUri(relativePath);

  const expectedPath = path.resolve(relativePath);
  assert.strictEqual(uri, `file://${expectedPath}`, "Should resolve relative path and create URI");
  console.log("✓ Test 2 passed: createFileUri with relative path");
}

async function testCreateFileUriWithSpaces() {
  const pathWithSpaces = "/Users/test/my project/file.ts";
  const uri = createFileUri(pathWithSpaces);

  assert.strictEqual(uri, `file://${pathWithSpaces}`, "Should handle paths with spaces");
  console.log("✓ Test 3 passed: createFileUri with spaces");
}

async function testCreateFileUriDotPath() {
  const dotPath = "./file.ts";
  const uri = createFileUri(dotPath);

  const expectedPath = path.resolve(dotPath);
  assert.strictEqual(uri, `file://${expectedPath}`, "Should resolve dot notation");
  console.log("✓ Test 4 passed: createFileUri with dot notation");
}

async function testCreateFileUriParentPath() {
  const parentPath = "../file.ts";
  const uri = createFileUri(parentPath);

  const expectedPath = path.resolve(parentPath);
  assert.strictEqual(uri, `file://${expectedPath}`, "Should resolve parent directory notation");
  console.log("✓ Test 5 passed: createFileUri with parent directory");
}

async function testCheckLspClientInitializedWithClient() {
  const mockClient = {
    initialized: true,
    openDocument: () => {}
  };

  // Should not throw
  checkLspClientInitialized(mockClient);
  console.log("✓ Test 6 passed: checkLspClientInitialized with valid client");
}

async function testCheckLspClientInitializedWithNull() {
  let errorThrown = false;
  let errorMessage = "";

  try {
    checkLspClientInitialized(null);
  } catch (err) {
    errorThrown = true;
    errorMessage = err.message;
  }

  assert.strictEqual(errorThrown, true, "Should throw error when client is null");
  assert.ok(errorMessage.includes("LSP server not ready"), "Error message should mention server not ready");
  console.log("✓ Test 7 passed: checkLspClientInitialized throws with null");
}

async function testCheckLspClientInitializedWithUndefined() {
  let errorThrown = false;

  try {
    checkLspClientInitialized(undefined);
  } catch (err) {
    errorThrown = true;
  }

  assert.strictEqual(errorThrown, true, "Should throw error when client is undefined");
  console.log("✓ Test 8 passed: checkLspClientInitialized throws with undefined");
}

async function testCreateFileUriConsistency() {
  const samePath = "/Users/test/file.ts";
  const uri1 = createFileUri(samePath);
  const uri2 = createFileUri(samePath);

  assert.strictEqual(uri1, uri2, "Should create consistent URIs for the same path");
  console.log("✓ Test 9 passed: createFileUri consistency");
}

async function testCreateFileUriEmptyString() {
  const emptyPath = "";
  const uri = createFileUri(emptyPath);

  // Should resolve to current working directory
  const expectedPath = path.resolve(emptyPath);
  assert.strictEqual(uri, `file://${expectedPath}`, "Should handle empty string");
  console.log("✓ Test 10 passed: createFileUri with empty string");
}

(async () => {
  try {
    await testCreateFileUriAbsolutePath();
    await testCreateFileUriRelativePath();
    await testCreateFileUriWithSpaces();
    await testCreateFileUriDotPath();
    await testCreateFileUriParentPath();
    await testCheckLspClientInitializedWithClient();
    await testCheckLspClientInitializedWithNull();
    await testCheckLspClientInitializedWithUndefined();
    await testCreateFileUriConsistency();
    await testCreateFileUriEmptyString();
    console.log("\nAll tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    console.error(err.stack);
    process.exit(1);
  }
})();
