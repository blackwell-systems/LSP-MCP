#!/usr/bin/env node
import assert from "assert";
import { parseUriPath, parseLocationParams } from "../dist/src/resources/index.js";

async function testParseUriPathAbsolute() {
  const uri = new URL("lsp-hover:///Users/test/file.ts");
  const path = parseUriPath(uri);

  assert.strictEqual(path, "/Users/test/file.ts", "Should parse absolute path");
  console.log("✓ Test 1 passed: parseUriPath with absolute path");
}

async function testParseUriPathWithQuery() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?line=10&column=5");
  const path = parseUriPath(uri);

  assert.strictEqual(path, "/Users/test/file.ts", "Should parse path without query params");
  console.log("✓ Test 2 passed: parseUriPath strips query parameters");
}

async function testParseUriPathWithSpaces() {
  const uri = new URL("lsp-hover:///Users/test/my%20project/file.ts");
  const path = parseUriPath(uri);

  assert.strictEqual(path, "/Users/test/my project/file.ts", "Should decode URL-encoded spaces");
  console.log("✓ Test 3 passed: parseUriPath decodes URL encoding");
}

async function testParseUriPathWithSpecialChars() {
  const uri = new URL("lsp-hover:///Users/test/file%40v2.ts");
  const path = parseUriPath(uri);

  assert.strictEqual(path, "/Users/test/file@v2.ts", "Should decode special characters");
  console.log("✓ Test 4 passed: parseUriPath decodes special characters");
}

async function testParseUriPathRoot() {
  const uri = new URL("lsp-hover:///");
  const path = parseUriPath(uri);

  assert.strictEqual(path, "/", "Should handle root path");
  console.log("✓ Test 5 passed: parseUriPath handles root");
}

async function testParseLocationParamsValid() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?line=10&column=5&language_id=typescript");
  const params = parseLocationParams(uri);

  assert.strictEqual(params.filePath, "/Users/test/file.ts", "Should extract file path");
  assert.strictEqual(params.line, 10, "Should extract line number");
  assert.strictEqual(params.character, 5, "Should extract character/column");
  assert.strictEqual(params.languageId, "typescript", "Should extract language ID");
  console.log("✓ Test 6 passed: parseLocationParams with valid params");
}

async function testParseLocationParamsMissingLanguageId() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?line=10&column=5");
  let errorThrown = false;
  let errorMessage = "";

  try {
    parseLocationParams(uri);
  } catch (err) {
    errorThrown = true;
    errorMessage = err.message;
  }

  assert.strictEqual(errorThrown, true, "Should throw error when language_id is missing");
  assert.ok(errorMessage.includes("language_id"), "Error message should mention language_id");
  console.log("✓ Test 7 passed: parseLocationParams throws without language_id");
}

async function testParseLocationParamsMissingLine() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?column=5&language_id=typescript");
  let errorThrown = false;
  let errorMessage = "";

  try {
    parseLocationParams(uri);
  } catch (err) {
    errorThrown = true;
    errorMessage = err.message;
  }

  assert.strictEqual(errorThrown, true, "Should throw error when line is missing");
  assert.ok(errorMessage.includes("Required parameters"), "Error message should mention required parameters");
  console.log("✓ Test 8 passed: parseLocationParams throws without line");
}

async function testParseLocationParamsMissingColumn() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?line=10&language_id=typescript");
  let errorThrown = false;

  try {
    parseLocationParams(uri);
  } catch (err) {
    errorThrown = true;
  }

  assert.strictEqual(errorThrown, true, "Should throw error when column is missing");
  console.log("✓ Test 9 passed: parseLocationParams throws without column");
}

async function testParseLocationParamsInvalidLine() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?line=abc&column=5&language_id=typescript");
  let errorThrown = false;
  let errorMessage = "";

  try {
    parseLocationParams(uri);
  } catch (err) {
    errorThrown = true;
    errorMessage = err.message;
  }

  assert.strictEqual(errorThrown, true, "Should throw error when line is not a number");
  assert.ok(errorMessage.includes("valid numbers"), "Error message should mention valid numbers");
  console.log("✓ Test 10 passed: parseLocationParams throws with invalid line");
}

async function testParseLocationParamsInvalidColumn() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?line=10&column=xyz&language_id=typescript");
  let errorThrown = false;

  try {
    parseLocationParams(uri);
  } catch (err) {
    errorThrown = true;
  }

  assert.strictEqual(errorThrown, true, "Should throw error when column is not a number");
  console.log("✓ Test 11 passed: parseLocationParams throws with invalid column");
}

async function testParseLocationParamsZeroValues() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?line=0&column=0&language_id=typescript");
  const params = parseLocationParams(uri);

  assert.strictEqual(params.line, 0, "Should handle line 0");
  assert.strictEqual(params.character, 0, "Should handle column 0");
  console.log("✓ Test 12 passed: parseLocationParams handles zero values");
}

async function testParseLocationParamsLargeNumbers() {
  const uri = new URL("lsp-hover:///Users/test/file.ts?line=10000&column=500&language_id=typescript");
  const params = parseLocationParams(uri);

  assert.strictEqual(params.line, 10000, "Should handle large line numbers");
  assert.strictEqual(params.character, 500, "Should handle large column numbers");
  console.log("✓ Test 13 passed: parseLocationParams handles large numbers");
}

async function testParseUriPathNormalization() {
  const uri = new URL("lsp-hover:///Users/test/../test/./file.ts");
  const path = parseUriPath(uri);

  // Path should be normalized
  assert.ok(path.includes("/Users/test/file.ts") || path === "/Users/test/file.ts", "Should normalize path");
  console.log("✓ Test 14 passed: parseUriPath normalizes paths");
}

async function testParseLocationParamsWithEncodedPath() {
  const uri = new URL("lsp-hover:///Users/test/my%20project/file.ts?line=10&column=5&language_id=typescript");
  const params = parseLocationParams(uri);

  assert.strictEqual(params.filePath, "/Users/test/my project/file.ts", "Should decode file path");
  console.log("✓ Test 15 passed: parseLocationParams decodes file path");
}

(async () => {
  try {
    await testParseUriPathAbsolute();
    await testParseUriPathWithQuery();
    await testParseUriPathWithSpaces();
    await testParseUriPathWithSpecialChars();
    await testParseUriPathRoot();
    await testParseLocationParamsValid();
    await testParseLocationParamsMissingLanguageId();
    await testParseLocationParamsMissingLine();
    await testParseLocationParamsMissingColumn();
    await testParseLocationParamsInvalidLine();
    await testParseLocationParamsInvalidColumn();
    await testParseLocationParamsZeroValues();
    await testParseLocationParamsLargeNumbers();
    await testParseUriPathNormalization();
    await testParseLocationParamsWithEncodedPath();
    console.log("\nAll tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    console.error(err.stack);
    process.exit(1);
  }
})();
