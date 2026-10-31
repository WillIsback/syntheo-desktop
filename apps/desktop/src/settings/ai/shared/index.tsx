import type { ComponentType } from "react";

type LobeIconComponent = ComponentType<{
  color?: string;
  size?: number | string;
}> & {
  Color?: ComponentType<{ size?: number | string }>;
  colorPrimary?: string;
};

const THEME_TINTED_BRAND_COLORS = new Set([
  "#000",
  "#000000",
  "#fff",
  "#ffffff",
  "#141413",
  "#16191e",
  "#f1f0e8",
]);

export function ProviderLobeIcon({ icon: Icon }: { icon: LobeIconComponent }) {
  if (Icon.Color) {
    return <Icon.Color />;
  }

  const brandColor = Icon.colorPrimary?.toLowerCase();
  if (brandColor && !THEME_TINTED_BRAND_COLORS.has(brandColor)) {
    return <Icon color={Icon.colorPrimary} />;
  }

  return <Icon />;
}
