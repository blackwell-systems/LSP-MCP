#!/usr/bin/env node
import assert from "assert";
import { waitForDiagnostics } from "../dist/src/shared/waitForDiagnostics.js";

// --- minimal mock LSPClient ---
function createMockLspClient() {
  const subscribers = new Set();
  return {
    subscribeToDiagnostics(cb) { subscribers.add(cb); },
    unsubscribeFromDiagnostics(cb) { subscribers.delete(cb); },
    triggerDiagnostics(uri, diags) {
      for (const cb of subscribers) cb(uri, diags);
    },
  };
}

async function testResolvesAfterFreshUpdate() {
  const mock = createMockLspClient();
  const uri = "file:///test.ts";
  const promise = waitForDiagnostics(mock, [uri]);

  // trigger initial snapshot (ignored)
  mock.triggerDiagnostics(uri, []);
  await new Promise(r => setTimeout(r, 100));

  // trigger real update
  mock.triggerDiagnostics(uri, [{ message: "error" }]);

  // should resolve within 1000ms (500ms stable delay + buffer)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Test timeout")), 1000)
  );

  await Promise.race([promise, timeout]);
  console.log("✓ Test 1 passed: resolves after fresh update");
}

async function testInitialSnapshotExcluded() {
  const mock = createMockLspClient();
  const uri = "file:///test.ts";
  const promise = waitForDiagnostics(mock, [uri]);

  // trigger only ONE diagnostic callback (initial snapshot)
  mock.triggerDiagnostics(uri, []);

  // Promise should NOT resolve within 200ms
  let resolved = false;
  promise.then(() => { resolved = true; });

  await new Promise(r => setTimeout(r, 200));

  assert.strictEqual(resolved, false, "Promise should not resolve with only initial snapshot");
  console.log("✓ Test 2 passed: initial snapshot is excluded");
}

async function testHardTimeout() {
  const mock = createMockLspClient();
  const uri = "file:///test.ts";

  // 300ms timeout
  const promise = waitForDiagnostics(mock, [uri], 300);

  // trigger no callbacks

  // should resolve within 600ms (300ms timeout + buffer)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Test timeout")), 600)
  );

  await Promise.race([promise, timeout]);
  console.log("✓ Test 3 passed: hard timeout path");
}

async function testMultipleUris() {
  const mock = createMockLspClient();
  const uri1 = "file:///test1.ts";
  const uri2 = "file:///test2.ts";
  const promise = waitForDiagnostics(mock, [uri1, uri2]);

  // trigger initial snapshot for both
  mock.triggerDiagnostics(uri1, []);
  mock.triggerDiagnostics(uri2, []);
  await new Promise(r => setTimeout(r, 100));

  // trigger real update for uri1 only
  mock.triggerDiagnostics(uri1, [{ message: "error" }]);

  // Promise should NOT resolve before uri2 gets its update
  let resolved = false;
  promise.then(() => { resolved = true; });

  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(resolved, false, "Promise should not resolve until all URIs updated");

  // now trigger real update for uri2
  mock.triggerDiagnostics(uri2, [{ message: "warning" }]);

  // should resolve within 1000ms
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Test timeout")), 1000)
  );

  await Promise.race([promise, timeout]);
  console.log("✓ Test 4 passed: multiple URIs, all must update");
}

async function testEmptyTargetUris() {
  const mock = createMockLspClient();
  const promise = waitForDiagnostics(mock, []);

  // should resolve within 700ms (stabilisation timer fires immediately)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Test timeout")), 700)
  );

  await Promise.race([promise, timeout]);
  console.log("✓ Test 5 passed: empty targetUris resolves immediately");
}

(async () => {
  try {
    await testResolvesAfterFreshUpdate();
    await testInitialSnapshotExcluded();
    await testHardTimeout();
    await testMultipleUris();
    await testEmptyTargetUris();
    console.log("\nAll tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    process.exit(1);
  }
})();
