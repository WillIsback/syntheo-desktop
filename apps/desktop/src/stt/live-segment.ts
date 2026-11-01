import type {
  LiveTranscriptSegment,
  RenderedTranscriptSegment,
  SegmentKey as BoundSegmentKey,
  SegmentWord as BoundSegmentWord,
} from "@syntheo/plugin-transcription";

import type { TranscriptWordMetadata } from "~/stt/timing";

export enum ChannelProfile {
  DirectMic = 0,
  RemoteParty = 1,
  MixedCapture = 2,
}

export type WordLike = {
  text: string;
  start_ms: number;
  end_ms: number;
  channel: ChannelProfile;
  metadata?: TranscriptWordMetadata | null;
};

type SpeakerHintData =
  | {
      type: "provider_speaker_index";
      speaker_index: number;
      provider?: string;
      channel?: number;
    }
  | { type: "user_speaker_assignment"; human_id: string };

export type RuntimeSpeakerHint = {
  wordIndex: number;
  data: SpeakerHintData;
};

export type RenderLabelContext = {
  getSelfHumanId: () => string | undefined;
  getHumanName: (id: string) => string | undefined;
  getParticipantHumanIds?: () => string[];
};

export type SegmentKey = BoundSegmentKey;
export type SegmentWord = BoundSegmentWord & {
  metadata?: TranscriptWordMetadata | null;
};
type SegmentWithWordMetadata<T extends { words: BoundSegmentWord[] }> = Omit<
  T,
  "words"
> & {
  words: SegmentWord[];
  speaker_label?: string;
  provisional_speaker?: RenderedTranscriptSegment["provisional_speaker"];
};
export type Segment =
  | SegmentWithWordMetadata<LiveTranscriptSegment>
  | SegmentWithWordMetadata<RenderedTranscriptSegment>;

export class SpeakerLabelManager {
  private unknownSpeakerMap: Map<string, number> = new Map();
  private nextIndex = 1;

  constructor(private readonly maxUnknownSpeakerNumber?: number) {}

  getUnknownSpeakerNumber(key: SegmentKey): number {
    const serialized = SegmentKeyUtils.serialize(key);
    const existing = this.unknownSpeakerMap.get(serialized);
    if (existing !== undefined) {
      return existing;
    }

    const newIndex =
      this.maxUnknownSpeakerNumber && this.maxUnknownSpeakerNumber > 0
        ? Math.min(this.nextIndex, this.maxUnknownSpeakerNumber)
        : this.nextIndex;
    this.unknownSpeakerMap.set(serialized, newIndex);
    this.nextIndex += 1;
    return newIndex;
  }

  static fromSegments(
    segments: Segment[],
    ctx?: RenderLabelContext,
    maxUnknownSpeakerNumber?: number,
  ): SpeakerLabelManager {
    const manager = new SpeakerLabelManager(maxUnknownSpeakerNumber);
    for (const segment of segments) {
      if (!SegmentKeyUtils.isKnownSpeaker(segment.key, ctx)) {
        manager.getUnknownSpeakerNumber(segment.key);
      }
    }
    return manager;
  }
}

export const SegmentKeyUtils = {
  serialize: (key: SegmentKey): string => {
    return JSON.stringify([
      key.channel,
      key.speaker_index ?? null,
      key.speaker_human_id ?? null,
    ]);
  },

  isKnownSpeaker: (key: SegmentKey, ctx?: RenderLabelContext): boolean => {
    if (key.speaker_human_id) {
      return true;
    }

    if (ctx && key.channel === "DirectMic") {
      return Boolean(ctx.getSelfHumanId());
    }

    if (ctx && key.channel === "RemoteParty") {
      return Boolean(getUniqueRemoteParticipantHumanId(ctx));
    }

    return false;
  },

  renderLabel: (
    key: SegmentKey,
    ctx?: RenderLabelContext,
    manager?: SpeakerLabelManager,
  ): string => {
    const assignedHumanId = key.speaker_human_id;

    if (ctx && assignedHumanId != null) {
      const human = ctx.getHumanName(assignedHumanId);
      if (human) {
        return human;
      }
    }

    if (ctx && key.channel === "DirectMic") {
      const selfHumanId = ctx.getSelfHumanId();
      if (
        selfHumanId &&
        (assignedHumanId == null || assignedHumanId === selfHumanId)
      ) {
        const selfHuman = ctx.getHumanName(selfHumanId);
        return selfHuman || "You";
      }
    }

    if (ctx && key.channel === "RemoteParty" && assignedHumanId == null) {
      const remoteHumanId = getUniqueRemoteParticipantHumanId(ctx);
      if (remoteHumanId) {
        return ctx.getHumanName(remoteHumanId) || remoteHumanId;
      }
    }

    if (manager) {
      const speakerNumber = manager.getUnknownSpeakerNumber(key);
      return `Speaker ${speakerNumber}`;
    }

    const channelLabel =
      key.channel === "DirectMic"
        ? "A"
        : key.channel === "RemoteParty"
          ? "B"
          : "C";

    return key.speaker_index !== null && key.speaker_index !== undefined
      ? `Speaker ${key.speaker_index + 1}`
      : `Speaker ${channelLabel}`;
  },
};

function getUniqueRemoteParticipantHumanId(
  ctx: RenderLabelContext,
): string | undefined {
  const selfHumanId = ctx.getSelfHumanId();
  const participantHumanIds = ctx.getParticipantHumanIds?.() ?? [];
  const remoteHumanIds = [
    ...new Set(
      participantHumanIds.filter(
        (humanId) => humanId && humanId !== selfHumanId,
      ),
    ),
  ];

  return remoteHumanIds.length === 1 ? remoteHumanIds[0] : undefined;
}

export function getMaxSpeakerNumberForParticipants(
  participantHumanIds: readonly string[],
  selfHumanId?: string | null,
): number | undefined {
  const ids = new Set(participantHumanIds.filter(Boolean));
  if (selfHumanId) {
    ids.add(selfHumanId);
  }

  return ids.size > 1 ? ids.size : undefined;
}
