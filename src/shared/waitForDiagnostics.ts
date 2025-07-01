import { debug } from "../logging/index.js";
import { LSPClient } from "../lspClient.js";

export const waitForDiagnostics = async (
  lspClient: LSPClient,
  targetUris: string[],
  timeoutMs: number = 3000
): Promise<void> => {
  debug(`Waiting up to ${timeoutMs}ms for diagnostics to stabilize for ${targetUris.length} files`);
  
  const startTime = Date.now();
  let lastDiagnosticTime = startTime;
  
  return new Promise((resolve) => {
    // Set up a listener for diagnostic updates
    const checkStability = () => {
      const now = Date.now();
      const timeSinceLastUpdate = now - lastDiagnosticTime;
      const totalElapsed = now - startTime;
      
      // If we've waited long enough since the last update, or we've hit the timeout
      if (timeSinceLastUpdate >= 500 || totalElapsed >= timeoutMs) {
        debug(`Diagnostics stabilized after ${totalElapsed}ms (${timeSinceLastUpdate}ms since last update)`);
        resolve();
        return;
      }
      
      // Check again in 100ms
      setTimeout(checkStability, 100);
    };
    
    // Subscribe to diagnostic updates to track when they change
    const diagnosticListener = (uri: string, diagnostics: any[]) => {
      if (targetUris.includes(uri)) {
        lastDiagnosticTime = Date.now();
        debug(`Received diagnostic update for ${uri}: ${diagnostics.length} diagnostics`);
      }
    };
    
    lspClient.subscribeToDiagnostics(diagnosticListener);
    
    // Start the stability check
    setTimeout(checkStability, 100);
    
    // Clean up the listener when we're done
    setTimeout(() => {
      lspClient.unsubscribeFromDiagnostics(diagnosticListener);
    }, timeoutMs + 1000);
  });
};
