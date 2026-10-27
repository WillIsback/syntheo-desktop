import type { TemplateSection } from "@syntheo/store";

/** Une ligne `^#+\s*(.+)` ouvre une section ; les lignes suivantes forment la consigne. */
export function parseTemplateMarkdown(markdown: string): TemplateSection[] {
  const sections: TemplateSection[] = [];
  let current: TemplateSection | null = null;

  for (const rawLine of markdown.split("\n")) {
    const heading = rawLine.match(/^#+\s*(.+?)\s*$/);
    if (heading) {
      if (current) {
        sections.push(current);
      }
      current = { title: heading[1], description: "" };
      continue;
    }
    if (!current) {
      continue;
    }
    const line = rawLine.trim();
    if (line) {
      current.description = current.description
        ? `${current.description}\n${line}`
        : line;
    }
  }

  if (current) {
    sections.push(current);
  }
  return sections;
}

export function templateSectionsToMarkdown(
  sections: TemplateSection[],
): string {
  return sections
    .map(
      (section) =>
        `# ${section.title}${section.description ? `\n${section.description}` : ""}`,
    )
    .join("\n\n");
}
