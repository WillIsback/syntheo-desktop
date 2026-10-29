import type { JSONContent } from "@syntheo/editor/chat";

const MAX_RETAINED_DRAFTS = 50;
const MAX_RETAINED_DRAFT_BYTES_PER_DRAFT = 16 * 1024 * 1024;
const MAX_RETAINED_DRAFT_BYTES = 32 * 1024 * 1024;
const MAX_JSON_DEPTH = 256;
const JSON_TWO_CHAR_ESCAPES = new Set([
  0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x22, 0x5c,
]);

type DraftEntry = {
  content: JSONContent;
  byteSize: number;
};

type ActiveDraftEntry = {
  content: JSONContent | undefined;
  leases: number;
};

export type DraftRetentionFailure = {
  draftKey: string;
  reason: "cache-full" | "draft-too-large" | "older-draft-removed";
  removedDraftCount?: number;
};

export class DraftCache {
  private readonly retained = new Map<string, DraftEntry>();
  private readonly active = new Map<string, ActiveDraftEntry>();
  private retainedBytes = 0;

  constructor(
    private readonly limits = {
      maxCount: MAX_RETAINED_DRAFTS,
      maxDraftBytes: MAX_RETAINED_DRAFT_BYTES_PER_DRAFT,
      maxRetainedBytes: MAX_RETAINED_DRAFT_BYTES,
    },
  ) {}

  peek(draftKey: string) {
    const active = this.active.get(draftKey);
    if (active) {
      return active.content;
    }

    const retained = this.retained.get(draftKey);
    if (retained) {
      this.retained.delete(draftKey);
      this.retained.set(draftKey, retained);
    }
    return retained?.content;
  }

  acquire(draftKey: string, initialContent: JSONContent | undefined) {
    const active = this.active.get(draftKey);
    if (active) {
      active.leases += 1;
      return;
    }

    const retained = this.takeRetained(draftKey);
    const content = retained?.content ?? initialContent;
    this.active.set(draftKey, {
      content,
      leases: 1,
    });
  }

  update(draftKey: string, content: JSONContent | undefined) {
    const active = this.active.get(draftKey);
    if (!active) {
      return;
    }
    active.content = content;
  }

  release(draftKey: string): DraftRetentionFailure | undefined {
    const active = this.active.get(draftKey);
    if (!active) {
      return;
    }
    active.leases -= 1;
    if (active.leases > 0) {
      return;
    }

    this.active.delete(draftKey);
    if (active.content) {
      return this.retain(draftKey, active.content);
    }
  }

  delete(draftKey: string) {
    this.takeRetained(draftKey);
    const active = this.active.get(draftKey);
    if (active) {
      active.content = undefined;
    }
  }

  private retain(
    draftKey: string,
    content: JSONContent,
  ): DraftRetentionFailure | undefined {
    this.takeRetained(draftKey);
    const byteSize = measureDraftBytes(content, this.limits.maxDraftBytes);
    if (byteSize > this.limits.maxDraftBytes) {
      return { draftKey, reason: "draft-too-large" };
    }

    let removedDraftCount = 0;
    while (
      this.retained.size >= this.limits.maxCount ||
      this.retainedBytes + byteSize > this.limits.maxRetainedBytes
    ) {
      const oldestDraftKey = this.retained.keys().next().value;
      if (oldestDraftKey === undefined) {
        return { draftKey, reason: "cache-full" };
      }
      this.takeRetained(oldestDraftKey);
      removedDraftCount += 1;
    }

    const entry = { content, byteSize };
    this.retained.set(draftKey, entry);
    this.retainedBytes += entry.byteSize;
    if (removedDraftCount > 0) {
      return {
        draftKey,
        reason: "older-draft-removed",
        removedDraftCount,
      };
    }
  }

  private takeRetained(draftKey: string) {
    const entry = this.retained.get(draftKey);
    if (entry) {
      this.retained.delete(draftKey);
      this.retainedBytes -= entry.byteSize;
    }
    return entry;
  }
}

export function measureDraftBytes(
  content: JSONContent | undefined,
  maxBytes = Number.POSITIVE_INFINITY,
) {
  if (!content) {
    return 0;
  }

  let bytes = 0;
  const seen = new WeakSet<object>();

  const addBytes = (count: number) => {
    bytes += count;
    return bytes <= maxBytes;
  };

  const forceOverflow = () => {
    bytes = maxBytes + 1;
  };

  const isDroppedByJson = (entry: unknown) =>
    entry === undefined ||
    typeof entry === "function" ||
    typeof entry === "symbol";

  function visit(value: unknown, depth: number) {
    if (bytes > maxBytes) {
      return;
    }
    if (depth > MAX_JSON_DEPTH) {
      forceOverflow();
      return;
    }
    if (value === null || value === undefined) {
      addBytes(4);
    } else if (typeof value === "string") {
      addBytes(measureJsonStringBytes(value, maxBytes - bytes));
    } else if (typeof value === "number") {
      addBytes(Number.isFinite(value) ? String(value).length : 4);
    } else if (typeof value === "boolean") {
      addBytes(value ? 4 : 5);
    } else if (Array.isArray(value)) {
      visitArray(value, depth);
    } else if (typeof value === "object") {
      visitObject(value, depth);
    } else {
      forceOverflow();
    }
  }

  function visitArray(value: unknown[], depth: number) {
    if (seen.has(value)) {
      forceOverflow();
      return;
    }
    seen.add(value);
    addBytes(2);
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        addBytes(1);
      }
      const entry = value[index];
      if (isDroppedByJson(entry)) {
        addBytes(4);
      } else {
        visit(entry, depth + 1);
      }
      if (bytes > maxBytes) {
        break;
      }
    }
    seen.delete(value);
  }

  function visitObject(value: object, depth: number) {
    if (seen.has(value)) {
      forceOverflow();
      return;
    }
    seen.add(value);
    addBytes(2);
    let entryCount = 0;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      const entry = (value as Record<string, unknown>)[key];
      if (isDroppedByJson(entry)) {
        continue;
      }
      if (entryCount > 0) {
        addBytes(1);
      }
      addBytes(measureJsonStringBytes(key, maxBytes - bytes) + 1);
      visit(entry, depth + 1);
      entryCount += 1;
      if (bytes > maxBytes) {
        break;
      }
    }
    seen.delete(value);
  }

  visit(content, 0);

  return bytes > maxBytes ? maxBytes + 1 : bytes;
}

function measureJsonStringBytes(value: string, maxBytes: number) {
  let bytes = 2;

  for (let index = 0; index < value.length && bytes <= maxBytes; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    bytes += jsonStringEscapedBytes(code);
    if (code > 0xffff) {
      index += 1;
    }
  }

  return bytes;
}

function jsonStringEscapedBytes(code: number) {
  if (JSON_TWO_CHAR_ESCAPES.has(code)) {
    return 2;
  }
  if (code < 0x20) {
    return 6;
  }
  if (code < 0x80) {
    return 1;
  }
  if (code < 0x800) {
    return 2;
  }
  if (code > 0xffff) {
    return 4;
  }
  if (code >= 0xd800 && code <= 0xdfff) {
    return 6;
  }
  return 3;
}
