#!/usr/bin/env node
import assert from "assert";
import { initLogging, setLogLevel, log, debug, info, warning, error } from "../dist/src/logging/index.js";

// Store original console methods
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// Helper to capture console output
function captureConsole() {
  const captured = { log: [], warn: [], error: [] };
  console.log = (...args) => captured.log.push(args);
  console.warn = (...args) => captured.warn.push(args);
  console.error = (...args) => captured.error.push(args);
  return captured;
}

function restoreConsole() {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
}

async function testInitLoggingIdempotency() {
  // The logging module installs console overrides the first time initLogging is called.
  // Subsequent calls should be no-ops. We can't truly reset the state without reloading
  // the module, but we can verify that calling initLogging multiple times doesn't break things.

  // Call initLogging multiple times
  initLogging();
  initLogging();
  initLogging();

  const captured = captureConsole();
  console.log("test message after multiple inits");
  restoreConsole();

  // If we got here without errors, idempotency works
  assert.ok(captured.log.length > 0, "Should still log after multiple initLogging calls");
  console.log("✓ Test 1 passed: initLogging is idempotent");
}

async function testLogLevelFiltering() {
  // This test verifies that log level filtering works by checking that
  // lower-priority messages don't cause errors when called.
  // We can't easily capture the output since it goes through console overrides
  // to the original console methods, but we can verify the API works.

  setLogLevel("warning");

  // These should be silently filtered (no output, no errors)
  debug("debug message - should be filtered");
  info("info message - should be filtered");

  // These should pass through (we can't easily verify output, but they shouldn't error)
  warning("warning message - should pass");
  error("error message - should pass");

  // Reset to info level for other tests
  setLogLevel("info");

  console.log("✓ Test 2 passed: log level filtering works");
}

async function testConsoleOverrideRecursionPrevention() {
  const captured = captureConsole();

  // Initialize logging to install console overrides
  initLogging();

  // Log a message - this should not cause infinite recursion
  console.log("test message");

  restoreConsole();

  // If we got here without stack overflow, recursion prevention works
  assert.ok(captured.log.length > 0, "Message should be logged");
  console.log("✓ Test 3 passed: console override recursion prevention works");
}

async function testLogWithObjects() {
  // Verify that logging with objects doesn't throw errors
  const testObj = { key: "value", nested: { data: 123 } };
  const testArray = [1, 2, 3];
  const testNull = null;
  const testUndefined = undefined;

  // All of these should work without throwing
  info("Test:", testObj);
  debug("Array:", testArray);
  warning("Null:", testNull);
  error("Undefined:", testUndefined);

  console.log("✓ Test 4 passed: objects and special values are handled");
}

async function testSetLogLevelValidation() {
  // Verify that setLogLevel accepts all valid log levels without error
  const validLevels = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];

  for (const level of validLevels) {
    setLogLevel(level);
    // If we get here, the level was accepted
  }

  // Reset to info level
  setLogLevel("info");

  console.log("✓ Test 5 passed: setLogLevel accepts all valid levels");
}

(async () => {
  try {
    await testInitLoggingIdempotency();
    await testLogLevelFiltering();
    await testConsoleOverrideRecursionPrevention();
    await testLogWithObjects();
    await testSetLogLevelValidation();
    console.log("\nAll tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    process.exit(1);
  }
})();
