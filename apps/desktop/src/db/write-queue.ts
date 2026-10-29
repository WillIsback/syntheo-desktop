const tails = new Map<string, Promise<unknown>>();
const pending = new Set<Promise<unknown>>();

interface FlushFailure {
  reason: unknown;
}

function firstRejected(
  results: readonly PromiseSettledResult<unknown>[],
): FlushFailure | undefined {
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  return rejected ? { reason: rejected.reason } : undefined;
}

export function enqueueDatabaseWrite<T>(
  key: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(write);

  tails.set(key, next);
  pending.add(next);
  next.then(
    () => finishWrite(key, next),
    () => finishWrite(key, next),
  );

  return next;
}

export async function flushDatabaseWrites(
  keys?: readonly string[],
): Promise<void> {
  if (keys) {
    await drainKeys([...new Set(keys)]);
  } else {
    await drainPending();
  }
}

export async function flushDatabaseWritesByPrefix(
  prefixes: readonly string[],
): Promise<void> {
  await drainKeysByPrefix([...new Set(prefixes)]);
}

export async function flushDatabaseWritesWithin(
  timeoutMs: number,
  keys?: readonly string[],
): Promise<void> {
  const flush = flushDatabaseWrites(keys);
  const timeoutError = new Error("Timed out waiting for local database writes");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      flush,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(timeoutError), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error === timeoutError) void flush.catch(() => undefined);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function drainKeys(
  uniqueKeys: readonly string[],
  failure?: FlushFailure,
): Promise<void> {
  const activeKeys = uniqueKeys.filter((key) => tails.has(key));
  if (activeKeys.length === 0) {
    if (failure) throw failure.reason;
    return;
  }
  const results = await Promise.allSettled(
    activeKeys.map((key) => flushDatabaseWriteKey(key)),
  );
  return drainKeys(uniqueKeys, failure ?? firstRejected(results));
}

async function drainPending(): Promise<void> {
  if (pending.size === 0) return;
  const results = await Promise.allSettled(Array.from(pending));
  const rejected = firstRejected(results);
  if (rejected) throw rejected.reason;
  return drainPending();
}

async function drainKeysByPrefix(
  uniquePrefixes: readonly string[],
  failure?: FlushFailure,
): Promise<void> {
  const keys = [...tails.keys()].filter((key) =>
    uniquePrefixes.some((prefix) => key.startsWith(prefix)),
  );
  if (keys.length === 0) {
    if (failure) throw failure.reason;
    return;
  }
  const results = await Promise.allSettled(
    keys.map((key) => flushDatabaseWriteKey(key)),
  );
  return drainKeysByPrefix(uniquePrefixes, failure ?? firstRejected(results));
}

async function flushDatabaseWriteKey(
  key: string,
  failure?: FlushFailure,
): Promise<void> {
  const write = tails.get(key);
  if (!write) {
    if (failure) throw failure.reason;
    return;
  }
  try {
    await write;
  } catch (error) {
    failure ??= { reason: error };
  }
  return flushDatabaseWriteKey(key, failure);
}

function finishWrite(key: string, write: Promise<unknown>) {
  pending.delete(write);
  if (tails.get(key) === write) tails.delete(key);
}
