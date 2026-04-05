#!/usr/bin/env node
import assert from "assert";

// Mock LSPClient with the helper methods we want to test
// We'll extract and test the key logic patterns

// Test getOverlappingDiagnostics logic
function getOverlappingDiagnostics(diagnostics, range) {
  return diagnostics.filter((d) => {
    if (!d.range) return false;
    const dStart = d.range.start;
    const dEnd = d.range.end;
    // Overlap: d starts before range ends, AND d ends after range starts
    const startsBeforeRangeEnd =
      dStart.line < range.end.line ||
      (dStart.line === range.end.line && dStart.character <= range.end.character);
    const endsAfterRangeStart =
      dEnd.line > range.start.line ||
      (dEnd.line === range.start.line && dEnd.character >= range.start.character);
    return startsBeforeRangeEnd && endsAfterRangeStart;
  });
}

// Test handleServerResponse logic
function handleServerResponse(message, responsePromises) {
  // Handle response messages
  if (
    "id" in message &&
    (message.result !== undefined || message.error !== undefined)
  ) {
    const promise = responsePromises.get(message.id);
    if (promise) {
      if (message.error) {
        promise.reject(message.error);
      } else {
        promise.resolve(message.result);
      }
      responsePromises.delete(message.id);
    }
  }

  // Extract server capabilities if present
  let serverCapabilities = null;
  if ("id" in message && message.result && typeof message.result === 'object' && message.result !== null && 'capabilities' in message.result) {
    serverCapabilities = message.result.capabilities;
  }
  return serverCapabilities;
}

async function testOverlappingDiagnosticsFullOverlap() {
  const diagnostics = [
    {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 15 }
      },
      message: "Error 1"
    },
    {
      range: {
        start: { line: 20, character: 0 },
        end: { line: 20, character: 10 }
      },
      message: "Error 2"
    }
  ];

  const range = {
    start: { line: 10, character: 0 },
    end: { line: 10, character: 20 }
  };

  const overlapping = getOverlappingDiagnostics(diagnostics, range);

  assert.strictEqual(overlapping.length, 1, "Should find 1 overlapping diagnostic");
  assert.strictEqual(overlapping[0].message, "Error 1", "Should find the correct diagnostic");
  console.log("✓ Test 1 passed: full overlap detection");
}

async function testOverlappingDiagnosticsPartialOverlap() {
  const diagnostics = [
    {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 15 }
      },
      message: "Error 1"
    }
  ];

  // Range that partially overlaps (starts before diagnostic ends)
  const range = {
    start: { line: 10, character: 10 },
    end: { line: 10, character: 20 }
  };

  const overlapping = getOverlappingDiagnostics(diagnostics, range);

  assert.strictEqual(overlapping.length, 1, "Should find partial overlap");
  console.log("✓ Test 2 passed: partial overlap detection");
}

async function testOverlappingDiagnosticsNoOverlap() {
  const diagnostics = [
    {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 15 }
      },
      message: "Error 1"
    }
  ];

  // Range that doesn't overlap
  const range = {
    start: { line: 15, character: 0 },
    end: { line: 15, character: 10 }
  };

  const overlapping = getOverlappingDiagnostics(diagnostics, range);

  assert.strictEqual(overlapping.length, 0, "Should find no overlap");
  console.log("✓ Test 3 passed: no overlap detection");
}

async function testOverlappingDiagnosticsMultiline() {
  const diagnostics = [
    {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 12, character: 10 }
      },
      message: "Multiline error"
    }
  ];

  // Range on line 11 (within the multiline diagnostic)
  const range = {
    start: { line: 11, character: 0 },
    end: { line: 11, character: 20 }
  };

  const overlapping = getOverlappingDiagnostics(diagnostics, range);

  assert.strictEqual(overlapping.length, 1, "Should detect overlap with multiline diagnostic");
  console.log("✓ Test 4 passed: multiline overlap detection");
}

async function testOverlappingDiagnosticsNoDiagnosticRange() {
  const diagnostics = [
    {
      message: "Error without range"
    },
    {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 15 }
      },
      message: "Error with range"
    }
  ];

  const range = {
    start: { line: 10, character: 0 },
    end: { line: 10, character: 20 }
  };

  const overlapping = getOverlappingDiagnostics(diagnostics, range);

  assert.strictEqual(overlapping.length, 1, "Should skip diagnostic without range");
  assert.strictEqual(overlapping[0].message, "Error with range", "Should find only the diagnostic with range");
  console.log("✓ Test 5 passed: diagnostics without range are skipped");
}

async function testHandleServerResponseSuccess() {
  const responsePromises = new Map();
  let resolvedResult = null;

  responsePromises.set(1, {
    resolve: (result) => { resolvedResult = result; },
    reject: (error) => { throw new Error("Should not reject"); }
  });

  const message = {
    jsonrpc: "2.0",
    id: 1,
    result: { data: "test result" }
  };

  handleServerResponse(message, responsePromises);

  assert.deepStrictEqual(resolvedResult, { data: "test result" }, "Should resolve with result");
  assert.strictEqual(responsePromises.has(1), false, "Should delete promise from map");
  console.log("✓ Test 6 passed: handleServerResponse resolves success");
}

async function testHandleServerResponseError() {
  const responsePromises = new Map();
  let rejectedError = null;

  responsePromises.set(2, {
    resolve: (result) => { throw new Error("Should not resolve"); },
    reject: (error) => { rejectedError = error; }
  });

  const message = {
    jsonrpc: "2.0",
    id: 2,
    error: { code: -32600, message: "Invalid request" }
  };

  handleServerResponse(message, responsePromises);

  assert.deepStrictEqual(rejectedError, { code: -32600, message: "Invalid request" }, "Should reject with error");
  assert.strictEqual(responsePromises.has(2), false, "Should delete promise from map");
  console.log("✓ Test 7 passed: handleServerResponse handles errors");
}

async function testHandleServerResponseNoPromise() {
  const responsePromises = new Map();

  const message = {
    jsonrpc: "2.0",
    id: 999,
    result: { data: "orphaned result" }
  };

  // Should not throw when no promise exists
  handleServerResponse(message, responsePromises);

  console.log("✓ Test 8 passed: handleServerResponse handles missing promise");
}

async function testHandleServerResponseExtractsCapabilities() {
  const responsePromises = new Map();
  let resolvedResult = null;

  responsePromises.set(1, {
    resolve: (result) => { resolvedResult = result; },
    reject: (error) => { throw new Error("Should not reject"); }
  });

  const message = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      capabilities: {
        textDocumentSync: 1,
        hoverProvider: true
      }
    }
  };

  const capabilities = handleServerResponse(message, responsePromises);

  assert.deepStrictEqual(capabilities, {
    textDocumentSync: 1,
    hoverProvider: true
  }, "Should extract server capabilities");
  console.log("✓ Test 9 passed: handleServerResponse extracts capabilities");
}

async function testOverlappingDiagnosticsEdgeCaseExactBoundary() {
  const diagnostics = [
    {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 15 }
      },
      message: "Error 1"
    }
  ];

  // Range that exactly matches the diagnostic end boundary
  const range = {
    start: { line: 10, character: 15 },
    end: { line: 10, character: 20 }
  };

  const overlapping = getOverlappingDiagnostics(diagnostics, range);

  assert.strictEqual(overlapping.length, 1, "Should detect overlap at exact boundary");
  console.log("✓ Test 10 passed: edge case exact boundary overlap");
}

(async () => {
  try {
    await testOverlappingDiagnosticsFullOverlap();
    await testOverlappingDiagnosticsPartialOverlap();
    await testOverlappingDiagnosticsNoOverlap();
    await testOverlappingDiagnosticsMultiline();
    await testOverlappingDiagnosticsNoDiagnosticRange();
    await testHandleServerResponseSuccess();
    await testHandleServerResponseError();
    await testHandleServerResponseNoPromise();
    await testHandleServerResponseExtractsCapabilities();
    await testOverlappingDiagnosticsEdgeCaseExactBoundary();
    console.log("\nAll tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    process.exit(1);
  }
})();
