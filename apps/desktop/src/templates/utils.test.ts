import { describe, expect, it } from "vitest";

import type { WebTemplate } from "./codec";
import type { UserTemplate } from "./queries";
import { DEFAULT_TEMPLATE_ICON } from "./template-icon";
import {
  AUTO_TEMPLATE_ID,
  filterWebTemplatesAgainstUserTemplates,
  groupUserTemplates,
  resolveTemplateTabSelection,
} from "./utils";

const userTemplate: UserTemplate = {
  id: "template-1",
  title: "Standup",
  description: "",
  pinned: false,
  icon: DEFAULT_TEMPLATE_ICON,
  sections: [],
};

const webTemplate: WebTemplate = {
  slug: "community-standup",
  title: "Community Standup",
  description: "",
  category: "",
  icon: DEFAULT_TEMPLATE_ICON,
  sections: [],
};

describe("resolveTemplateTabSelection", () => {
  it.each([
    [
      "keeps an empty tab in local template mode when there are no community templates",
      {
        isWebMode: true,
        selectedMineId: null,
        selectedWebIndex: null,
        userTemplates: [],
        webTemplates: [],
      },
      {
        isWebMode: false,
        selectedMineId: AUTO_TEMPLATE_ID,
        selectedWebIndex: null,
        selectedWebTemplate: null,
      },
    ],
    [
      "defaults to community mode only when community templates exist without local templates",
      {
        isWebMode: null,
        selectedMineId: null,
        selectedWebIndex: null,
        userTemplates: [],
        webTemplates: [webTemplate],
      },
      {
        isWebMode: true,
        selectedMineId: null,
        selectedWebIndex: 0,
        selectedWebTemplate: webTemplate,
      },
    ],
    [
      "selects the first local template when mine mode has no explicit selection",
      {
        isWebMode: false,
        selectedMineId: null,
        selectedWebIndex: null,
        userTemplates: [userTemplate],
        webTemplates: [webTemplate],
      },
      {
        isWebMode: false,
        selectedMineId: "template-1",
        selectedWebIndex: null,
        selectedWebTemplate: null,
      },
    ],
    [
      "preserves an explicit Auto selection when local templates exist",
      {
        isWebMode: false,
        selectedMineId: AUTO_TEMPLATE_ID,
        selectedWebIndex: null,
        userTemplates: [userTemplate],
        webTemplates: [webTemplate],
      },
      {
        isWebMode: false,
        selectedMineId: AUTO_TEMPLATE_ID,
        selectedWebIndex: null,
        selectedWebTemplate: null,
      },
    ],
  ])("%s", (_name, input, expected) => {
    expect(resolveTemplateTabSelection(input)).toEqual(expected);
  });
});

describe("filterWebTemplatesAgainstUserTemplates", () => {
  it("drops web templates that already exist locally by normalized title", () => {
    const duplicateWebTemplate = {
      ...webTemplate,
      slug: "daily-standup",
      title: "Daily Standup",
    };
    const uniqueWebTemplate = {
      ...webTemplate,
      slug: "sales-discovery-call",
      title: "Sales Discovery Call",
    };

    expect(
      filterWebTemplatesAgainstUserTemplates({
        userTemplates: [{ ...userTemplate, title: "daily standup" }],
        webTemplates: [duplicateWebTemplate, uniqueWebTemplate],
      }),
    ).toEqual([uniqueWebTemplate]);

    expect(
      filterWebTemplatesAgainstUserTemplates({
        userTemplates: [{ ...userTemplate, title: "1 1 meeting" }],
        webTemplates: [
          { ...webTemplate, slug: "one-on-one-meeting", title: "1:1 Meeting" },
        ],
      }),
    ).toEqual([]);
  });
});

describe("groupUserTemplates", () => {
  const make = (
    id: string,
    title: string,
    extra: Partial<UserTemplate> = {},
  ): UserTemplate => ({ ...userTemplate, id, title, ...extra });

  const templates = [
    make("ca", "Conseil d'administration", { targets: ["PDG"] }),
    make("equipe", "Point d'équipe", { pinned: true, pinOrder: 2 }),
    make("entretien", "Entretien individuel", { pinned: true, pinOrder: 1 }),
    make("annuel", "Entretien annuel", { targets: ["RH"] }),
  ];

  it("sépare les favoris (ordre d'épinglage) des autres (ordre alphabétique)", () => {
    const { favorites, others } = groupUserTemplates(templates);

    expect(favorites.map((t) => t.id)).toEqual(["entretien", "equipe"]);
    expect(others.map((t) => t.id)).toEqual(["ca", "annuel"]);
  });

  it("filtre sur le nom et sur « Utilisé pour »", () => {
    expect(groupUserTemplates(templates, "rh").others.map((t) => t.id)).toEqual(
      ["annuel"],
    );
    expect(groupUserTemplates(templates, "entretien")).toEqual({
      favorites: [templates[2]],
      others: [templates[3]],
    });
  });
});
