export function changelogUrl(version: string): string | null {
  if (/^\d+\.\d+\.\d+-nightly\.\d+$/.test(version)) {
    return `https://api.github.com/repos/WillIsback/syntheo-desktop/releases/tags/desktop_nightly_v${version}`;
  }
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    return `https://raw.githubusercontent.com/WillIsback/syntheo-desktop/main/packages/changelog/content/desktop/${version}.md`;
  }
  return null;
}
