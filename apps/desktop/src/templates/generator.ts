import { generateObject, generateText } from "ai";
import { z } from "zod";

import type { TemplateSection } from "@syntheo/store";

import { parseTemplateMarkdown } from "./markdown";
import { normalizeTemplateIcon, type TemplateIcon } from "./template-icon";

export const TEMPLATE_GEN_SYSTEM_PROMPT = `Tu conçois des modèles de compte rendu de réunion en français.
À partir d'une description, propose un modèle avec un titre court, une description, une catégorie, une icône et 3 à 6 sections.
Chaque section a un titre et une consigne décrivant ce que le compte rendu doit contenir.
Utilise le vouvoiement, un ton sobre et professionnel. Réponds uniquement en français.`;

export type GeneratedTemplate = {
  title: string;
  description: string;
  category: string;
  icon: TemplateIcon;
  sections: TemplateSection[];
};

export const generatedTemplateSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  category: z.string(),
  icon: z
    .string()
    .describe("identifiant d'icône, ex. file-text, shield-check, kanban, zap"),
  sections: z
    .array(z.object({ title: z.string().min(1), description: z.string() }))
    .min(3)
    .max(6),
});

type Model = Parameters<typeof generateObject>[0]["model"];

function buildPrompt(input: string, existingNote?: string): string {
  const base = `Décris le modèle de compte rendu à générer : ${input}`;
  return existingNote
    ? `${base}\n\nInspire-toi de cette note existante :\n${existingNote}`
    : base;
}

export async function generateTemplate({
  model,
  input,
  existingNote,
}: {
  model: Model;
  input: string;
  existingNote?: string;
}): Promise<GeneratedTemplate> {
  const prompt = buildPrompt(input, existingNote);

  try {
    const { object } = await generateObject({
      model,
      schema: generatedTemplateSchema,
      system: TEMPLATE_GEN_SYSTEM_PROMPT,
      prompt,
    });
    return {
      title: object.title,
      description: object.description,
      category: object.category,
      icon: normalizeTemplateIcon({
        type: "icon",
        value: object.icon,
        color: "#1a73e8",
      }),
      sections: object.sections,
    };
  } catch {
    // Repli pour les modèles sans sortie JSON structurée : génération Markdown.
    const { text } = await generateText({
      model,
      system: `${TEMPLATE_GEN_SYSTEM_PROMPT}\nRéponds en Markdown : une ligne de titre, puis chaque section sous la forme « # Titre » suivi de la consigne.`,
      prompt,
    });
    return {
      title: input.trim().slice(0, 80) || "Nouveau modèle",
      description: "",
      category: "Général",
      icon: normalizeTemplateIcon(undefined),
      sections: parseTemplateMarkdown(text),
    };
  }
}
