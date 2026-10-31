import { getTranscriptionLanguages } from "~/stt/capabilities";
import {
  getDefaultSttModel,
  getPreferredProviderModel,
} from "~/stt/model-selection";

export { getDefaultSttModel, getPreferredProviderModel };

export async function getLanguageSupportIssue(
  mainLanguage: string | null | undefined,
  spokenLanguages: readonly string[] | null | undefined,
  isSupported: (languages: readonly string[]) => Promise<boolean>,
) {
  const languages = getTranscriptionLanguages(mainLanguage, spokenLanguages);
  if (await isSupported(languages)) {
    return null;
  }

  const supportByLanguage = await Promise.all(
    languages.map(async (language) => ({
      language,
      supported: await isSupported([language]),
    })),
  );

  return {
    unsupportedLanguages: supportByLanguage
      .filter(({ supported }) => !supported)
      .map(({ language }) => language),
  };
}

export function resolveLiveLanguageSupportMode({
  isOnDeviceModel,
  useLiveOnDeviceModel,
  liveSupported,
}: {
  isOnDeviceModel: boolean;
  useLiveOnDeviceModel: boolean;
  liveSupported: boolean | undefined;
}): boolean | undefined {
  return isOnDeviceModel
    ? useLiveOnDeviceModel && liveSupported
    : liveSupported;
}
