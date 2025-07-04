// lsp-mcp/src/shared/waitForDiagnostics.ts
import { debug } from "../logging/index.js";
import { LSPClient } from "../lspClient.js";

/**
 * Wait until diagnostics “settle” for all target URIs.
 *
 * Procedure
 *   1.  When we subscribe, the LSP client instantly re-plays the diagnostics it
 *       already has in its cache.  We call that the “initial snapshot” and
 *       IGNORE it – otherwise we would finish too early.
 *   2.  After the snapshot we require at least ONE fresh diagnostics
 *       notification for every tracked file.
 *   3.  When there have been no further updates for STABLE_DELAY ms, or when
 *       the hard timeout elapses, we resolve.
 */
export const waitForDiagnostics = async (
  lspClient: LSPClient,
  targetUris: string[],
  timeoutMs: number = 25_000,
): Promise<void> => {
  const STABLE_DELAY = 500; // ms of silence that counts as “stable”

  debug(
    `Waiting (≤ ${timeoutMs} ms) for diagnostics to stabilise for ` +
      `${targetUris.length} file(s)…`,
  );

  return new Promise<void>((resolve) => {
    /* ------------------------------------------------------------------ util */
    const finish = (reason: string): void => {
      debug(reason);
      lspClient.unsubscribeFromDiagnostics(diagnosticListener);
      clearTimeout(hardTimeout);
      if (stabilisationTimer) clearTimeout(stabilisationTimer);
      resolve();
    };

    /* ------------------------------------------------ bookkeeping per file */
    const sawInitialSnapshot: Record<string, boolean> = Object.fromEntries(
      targetUris.map((u) => [u, false]),
    );
    const gotFreshUpdate: Record<string, boolean> = Object.fromEntries(
      targetUris.map((u) => [u, false]),
    );

    const allFilesHaveFreshUpdate = (): boolean =>
      targetUris.every((u) => gotFreshUpdate[u]);

    /* ---------------------------------------------------- stabilisation 🔔 */
    let lastUpdateTimestamp = Date.now();
    let stabilisationTimer: NodeJS.Timeout | null = null;

    const armStabilisationTimer = () => {
      if (stabilisationTimer) clearTimeout(stabilisationTimer);
      stabilisationTimer = setTimeout(() => {
        const idleFor = Date.now() - lastUpdateTimestamp;
        if (idleFor >= STABLE_DELAY && allFilesHaveFreshUpdate()) {
          finish(
            `Diagnostics stable (no updates for ${idleFor} ms) – finishing.`,
          );
        }
      }, STABLE_DELAY);
    };

    /* ------------------------------------------------ listener definition */
    const diagnosticListener = (uri: string, diagnostics: any[]): void => {
      if (!targetUris.includes(uri)) return;

      // first callback for that URI == initial snapshot -> ignore
      if (!sawInitialSnapshot[uri]) {
        sawInitialSnapshot[uri] = true;
        debug(
          `Initial diagnostics snapshot for ${uri} ignored ` +
            `(${diagnostics.length} item(s))`,
        );
        return;
      }

      // real update
      gotFreshUpdate[uri] = true;
      lastUpdateTimestamp = Date.now();

      debug(
        `Fresh diagnostics for ${uri}: ${diagnostics.length} item(s). ` +
          `(${Object.values(gotFreshUpdate).filter(Boolean).length}/${
            targetUris.length
          } files updated)`,
      );

      armStabilisationTimer();
    };

    /* ----------------------------------------------------- set it all up */
    lspClient.subscribeToDiagnostics(diagnosticListener);
    armStabilisationTimer(); // in case nothing arrives after snapshot

    const hardTimeout = setTimeout(() => {
      finish(
        `Timed out after ${timeoutMs} ms – proceeding with current diagnostics.`,
      );
    }, timeoutMs);
  });
};
