/** In-memory leases. The last consumer aborts pending work and releases decoded assets. */
export class ResourcePool {
  private entries = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<unknown>;
      references: number;
      dispose: () => void;
    }
  >();

  acquire<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    dispose: (value: T) => void = () => {},
  ) {
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, references: 0, promise: Promise.resolve(), dispose: () => {} };
      const current = entry;
      current.promise = load(controller.signal)
        .then((value) => {
          if (controller.signal.aborted) {
            dispose(value);
            controller.signal.throwIfAborted();
          }
          current.dispose = () => dispose(value);
          return value;
        })
        .catch((error: unknown) => {
          if (this.entries.get(key) === current) this.entries.delete(key);
          throw error;
        });
      this.entries.set(key, current);
    }
    entry.references++;
    const current = entry;
    let released = false;
    return {
      promise: current.promise as Promise<T>,
      release: () => {
        if (released) return;
        released = true;
        if (--current.references === 0) {
          current.controller.abort();
          current.dispose();
          current.dispose = () => {};
          if (this.entries.get(key) === current) this.entries.delete(key);
        }
      },
    };
  }

  clear() {
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      entry.dispose();
      entry.dispose = () => {};
    }
    this.entries.clear();
  }
}
