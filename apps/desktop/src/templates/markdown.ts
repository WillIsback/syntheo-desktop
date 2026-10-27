import type { TemplateSection } from "@syntheo/store";

/** Une ligne `^#+\s*(.+)` ouvre une section ; les lignes suivantes forment la consigne. */
export function parseTemplateMarkdown(markdown: string): TemplateSection[] {
  const sections: TemplateSection[] = [];
  let current: TemplateSection | null = null;

  for (const rawLine of markdown.split("\n")) {
    // `(.+)` borné puis `trimEnd()` : plus linéaire que `(.+?)\s*$`.
    const heading = /^#+[ \t]*(.+)$/.exec(rawLine);
    if (heading) {
      if (current) {
        sections.push(current);
      }
      current = { title: heading[1].trimEnd(), description: "" };
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
    .map((section) => {
      const description = section.description ? `\n${section.description}` : "";
      return `# ${section.title}${description}`;
    })
    .join("\n\n");
}
