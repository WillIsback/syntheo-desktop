import type { SpeakerHintStorage, WordStorage } from "@syntheo/store";

export type WordWithId = WordStorage & { id: string };
export type SpeakerHintWithId = SpeakerHintStorage & { id: string };
