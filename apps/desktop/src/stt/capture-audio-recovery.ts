import type { RecoveryAudioChunk } from "@anlg/plugin-transcription";

export type RecoveryInterval = { start: number; end: number };

// All times are relative to the frontend capture's start. Chunks retain their
// native capture timestamp so renderer reloads and recorder restarts stay aligned.
export function chunkInterval(chunk: RecoveryAudioChunk, startedAt: number) {
  const offset = chunk.capture_started_at - startedAt;
  return { start: offset + chunk.start_ms, end: offset + chunk.end_ms };
}

export function subtractIntervals(
  from: RecoveryInterval[],
  remove: RecoveryInterval[],
): RecoveryInterval[] {
  let result = from.filter((gap) => gap.start < gap.end);
  for (const cut of remove) {
    result = result.flatMap((gap) => {
      if (cut.end <= gap.start || cut.start >= gap.end) return [gap];
      return [
        ...(cut.start > gap.start
          ? [{ start: gap.start, end: cut.start }]
          : []),
        ...(cut.end < gap.end ? [{ start: cut.end, end: gap.end }] : []),
      ];
    });
  }
  return result;
}

export function createCaptureAudioRecovery(options: {
  startedAt: number;
  list: () => Promise<RecoveryAudioChunk[]>;
  acknowledge: (chunk: RecoveryAudioChunk) => Promise<void>;
  flush: () => Promise<void>;
  repair: (
    chunk: RecoveryAudioChunk,
    intervals: RecoveryInterval[],
    signal: AbortSignal,
  ) => Promise<void>;
  // Chunks from earlier captures are repaired whole into their own transcript.
  inherited?: (chunk: RecoveryAudioChunk) => boolean;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<boolean> | undefined;
  let active = false;
  let online = true;
  let confirmedThrough = 0;
  let acknowledgedThrough = 0;
  let gapStart: number | undefined;
  let gaps: RecoveryInterval[] = [];
  // Historique des coupures : jamais purgé par la réparation. Sans audio
  // conservé, il est la seule trace des passages manquants du transcript.
  let interrupted: RecoveryInterval[] = [];
  let repaired: RecoveryInterval[] = [];
  // Audio hérité vu pendant la capture : la complétude suit alors la réparation.
  let sawAudio = false;
  let pending = false;
  let failed = false;
  let retryAt = 0;
  let recoverThrough = 0;
  let revision = 0;
  let batchFromRetainedAudio = false;
  let sawConnectionEvent = false;

  const elapsed = () => Math.max(0, now() - options.startedAt);
  const collapseGaps = () => {
    if (gaps.length > 128)
      gaps = [{ start: gaps[0]!.start, end: gaps[gaps.length - 1]!.end }];
  };
  const markGap = () => {
    revision += 1;
    gapStart ??= Math.max(acknowledgedThrough, confirmedThrough - 1_000);
    pending = true;
  };
  const closeGap = () => {
    if (gapStart === undefined) return;
    revision += 1;
    const gap = { start: gapStart, end: elapsed() };
    gaps.push(gap);
    interrupted.push(gap);
    if (interrupted.length > 128)
      interrupted = [
        {
          start: interrupted[0]!.start,
          end: interrupted[interrupted.length - 1]!.end,
        },
      ];
    gapStart = undefined;
    collapseGaps();
  };
  // Coupures restées sans transcript : l'historique moins ce qu'une
  // réparation (audio hérité uniquement) a comblé.
  const interruptions = (): RecoveryInterval[] =>
    subtractIntervals(
      gapStart === undefined
        ? interrupted
        : [...interrupted, { start: gapStart, end: elapsed() }],
      repaired,
    );

  const process = async (settle: boolean) => {
    const chunks = await options.list();
    if (chunks.length > 0) sawAudio = true;
    pending = gapStart !== undefined || gaps.length > 0;
    for (const chunk of chunks) {
      controller.signal.throwIfAborted();
      if (options.inherited?.(chunk)) {
        pending = true;
        if (!online || now() < retryAt) return false;
        await options.repair(chunk, [], controller.signal);
        controller.signal.throwIfAborted();
        await options.acknowledge(chunk);
        continue;
      }
      const range = chunkInterval(chunk, options.startedAt);
      if (!settle && range.end > elapsed() - 10_000) continue;
      if (batchFromRetainedAudio) {
        await options.acknowledge(chunk);
        continue;
      }
      await options.flush();
      controller.signal.throwIfAborted();
      const repairRevision = revision;
      const intervals = [
        ...gaps,
        ...(recoverThrough > range.start
          ? [{ start: range.start, end: recoverThrough }]
          : []),
        ...(gapStart === undefined
          ? []
          : [{ start: gapStart, end: elapsed() }]),
      ]
        .map((gap) => ({
          start: Math.max(gap.start, range.start),
          end: Math.min(gap.end, range.end),
        }))
        .filter((gap) => gap.start < gap.end);
      let coveredThrough = Math.max(range.start, confirmedThrough);
      for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
        if (interval.start <= coveredThrough)
          coveredThrough = Math.max(coveredThrough, interval.end);
      }
      if (!settle && coveredThrough < range.end) continue;
      if (intervals.length > 0) {
        pending = true;
        if (!online || now() < retryAt) return false;
        await options.repair(chunk, intervals, controller.signal);
        controller.signal.throwIfAborted();
        repaired.push(...intervals);
      }
      if (repairRevision !== revision) return false;
      // Network success alone is insufficient: repair resolves after SQLite commits.
      await options.acknowledge(chunk);
      acknowledgedThrough = Math.max(acknowledgedThrough, range.end);
      gaps = gaps.flatMap((gap) =>
        gap.end <= range.end
          ? []
          : [{ start: Math.max(gap.start, range.end), end: gap.end }],
      );
      if (gapStart !== undefined) gapStart = Math.max(gapStart, range.end);
    }
    if (settle && chunks.length < 128) gaps = [];
    pending = gapStart !== undefined || gaps.length > 0 || chunks.length >= 128;
    return settle && chunks.length >= 128;
  };

  const tick = (settle = false) => {
    if (running) return running;
    running = process(settle)
      .catch((error) => {
        if (controller.signal.aborted) return false;
        pending = true;
        retryAt = now() + 30_000;
        console.warn("[listener] audio recovery deferred", error);
        return false;
      })
      .finally(() => {
        running = undefined;
        if (active) timer = setTimeout(() => void tick(), 5_000);
      });
    return running;
  };

  return {
    start() {
      if (active || controller.signal.aborted) return;
      active = true;
      timer = setTimeout(() => void tick(), 5_000);
    },
    persistedThrough(endMs: number) {
      confirmedThrough = Math.max(confirmedThrough, endMs);
    },
    interrupted() {
      sawConnectionEvent = true;
      online = false;
      markGap();
    },
    // Sans audio conservé (cas de toute capture Syntheo), une capture sans STT
    // en direct est une coupure ; `true` ne sert qu'à l'audio hérité.
    batchOnly(retainAudio = false) {
      sawConnectionEvent = true;
      online = true;
      batchFromRetainedAudio = retainAudio;
      if (!retainAudio) markGap();
    },
    recoverPending() {
      recoverThrough = elapsed();
      pending = true;
      online = true;
    },
    restore(ledger: {
      gaps: RecoveryInterval[];
      openGapStart?: number;
      awaitingConnection: boolean;
      storageFailed: boolean;
      confirmedThrough?: number;
    }) {
      revision += 1;
      confirmedThrough = Math.max(
        confirmedThrough,
        ledger.confirmedThrough ?? 0,
      );
      failed ||= ledger.storageFailed;
      gaps.push(...ledger.gaps);
      interrupted.push(...ledger.gaps);
      collapseGaps();
      if (ledger.openGapStart !== undefined) {
        if (gapStart === undefined && !sawConnectionEvent) {
          gapStart = ledger.openGapStart;
          online = !ledger.awaitingConnection;
        } else if (gapStart === undefined) {
          gaps.push({ start: ledger.openGapStart, end: elapsed() });
        } else {
          gapStart = Math.min(gapStart, ledger.openGapStart);
        }
        collapseGaps();
      }
      pending = true;
      retryAt = 0;
    },
    connected() {
      sawConnectionEvent = true;
      closeGap();
      online = true;
      retryAt = 0;
    },
    persistenceFailed() {
      markGap();
      closeGap();
    },
    storageFailed() {
      failed = true;
      markGap();
    },
    interruptions,
    async stop() {
      active = false;
      clearTimeout(timer);
      closeGap();
      const missing = interruptions();
      await running;
      while (await tick(true)) {
        controller.signal.throwIfAborted();
      }
      if (sawAudio) return { incomplete: pending || failed, interruptions: [] };
      return {
        incomplete: pending || failed || missing.length > 0,
        interruptions: missing,
      };
    },
    cancel() {
      active = false;
      clearTimeout(timer);
      controller.abort();
    },
    tick,
  };
}
