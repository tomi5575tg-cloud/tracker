export interface SessionDrainHook {
  drain(reason: string, previousSession: unknown): Promise<void> | void;
}

export interface SessionDrainOptions {
  readonly reason?: string;
  readonly clearStorage?: boolean;
  readonly cancelPendingRequests?: boolean;
}

export class SessionDrainManager {
  private hooks: Set<SessionDrainHook> = new Set();
  private abortController: AbortController = new AbortController();

  /**
   * Registers a drain hook (e.g. Map route cleaner, cache purger, state resetter)
   */
  public registerHook(hook: SessionDrainHook): () => void {
    this.hooks.add(hook);
    return () => {
      this.hooks.delete(hook);
    };
  }

  /**
   * Returns an AbortSignal tied to the current active session.
   * When session drains, signal is aborted.
   */
  public getSignal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Executes deep drainage of session resources:
   * 1. Signals cancellation to all in-flight requests / operations via AbortController
   * 2. Executes all registered drain hooks in parallel with individual error isolation
   * 3. Re-initializes a fresh AbortController for subsequent session
   */
  public async drain(reason = 'SESSION_LOGOUT_OR_SWITCH', previousSession: unknown = null): Promise<void> {
    // 1. Abort current session operations
    this.abortController.abort(new Error(`Session drained: ${reason}`));

    // 2. Prepare new controller for future session
    this.abortController = new AbortController();

    // 3. Execute all hooks with individual protection
    const hookPromises = Array.from(this.hooks).map(async (hook) => {
      try {
        await hook.drain(reason, previousSession);
      } catch (error) {
        // Log or isolate error without failing other drainers
        console.error(`[SessionDrainManager] Error during drain hook execution:`, error);
      }
    });

    await Promise.all(hookPromises);
  }
}
