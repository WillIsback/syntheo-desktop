import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { forwardRef, useImperativeHandle, useRef } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { NoteInput } from "../note-input";

import type { NoteStage } from "~/session/components/capsule/stage";
import { updateSession } from "~/session/queries";
import type { Tab } from "~/store/zustand/tabs";

// Issue #268 : le type de réunion choisi en Préparer revenait sur
// « Automatique ». Ce test rejoue le choix sur une vraie base SQLite construite
// à partir des migrations, avec les vraies requêtes de session (lecture
// `useSession`, écriture `updateSession`), la vraie fiche et le vrai sélecteur.
//
// Issue #275 : le document est rendu par le vrai `NoteInput`, dont le
// `onMouseDown` du conteneur place le curseur dans l'éditeur quand on clique
// dans le vide. Les clics sont rejoués comme dans un navigateur (pointerdown,
// mousedown, puis mouseup et click sur ce qui est encore sous le pointeur) :
// `fireEvent.click` seul saute le mousedown, là où se jouait le bug.

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
type SqlParams = import("node:sqlite").SQLInputValue[];

const mocks = vi.hoisted(() => ({
  database: null as null | import("node:sqlite").DatabaseSync,
  listeners: new Set<() => void>(),
  editorText: "",
}));

function query(sql: string, params: unknown[] = []) {
  return mocks.database!.prepare(sql).all(...(params as SqlParams));
}

vi.mock("~/db", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    liveQueryClient: {
      execute: async (sql: string, params?: unknown[]) => query(sql, params),
    },
    executeTransaction: async (
      statements: Array<{ sql: string; params: unknown[] }>,
    ) => {
      const database = mocks.database!;
      database.exec("BEGIN");
      try {
        const changes = statements.map(
          ({ sql, params }) =>
            database.prepare(sql).run(...(params as SqlParams)).changes,
        );
        database.exec("COMMIT");
        return changes;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        mocks.listeners.forEach((listener) => listener());
      }
    },
    // Live query: re-read the real database after every write.
    useLiveQuery: (options: {
      sql: string;
      params?: unknown[];
      enabled?: boolean;
      mapRows?: (rows: Array<Record<string, unknown>>) => unknown;
    }) => {
      const [, refresh] = React.useReducer((count: number) => count + 1, 0);
      React.useEffect(() => {
        mocks.listeners.add(refresh);
        return () => {
          mocks.listeners.delete(refresh);
        };
      }, []);
      if (options.enabled === false) return { data: undefined };
      const rows = query(options.sql, options.params) as Array<
        Record<string, unknown>
      >;
      return { data: options.mapRows ? options.mapRows(rows) : rows };
    },
  };
});

// The note editor autosaves through `updateSession({ raw_md })`, as
// `RawEditor.persistChange` does when no template was applied from it.
vi.mock("../note-input/raw", async () => {
  const { updateSession: persist } = await vi.importActual<
    typeof import("~/session/queries/sessions")
  >("~/session/queries/sessions");
  return {
    RawEditor: forwardRef(function RawEditor(
      props: { sessionId: string; rawMd: string },
      ref,
    ) {
      const doc = () => ({
        type: "doc",
        content: mocks.editorText
          ? [
              {
                type: "paragraph",
                content: [{ type: "text", text: mocks.editorText }],
              },
            ]
          : [],
      });
      const dom = useRef<HTMLDivElement>(null);
      // Like ProseMirror, focusing the editor moves the DOM focus into it.
      const focus = () => dom.current?.focus();
      useImperativeHandle(ref, () => ({
        view: { state: { doc: { toJSON: doc } } },
        flushPendingChanges: () => {
          void persist(props.sessionId, { raw_md: JSON.stringify(doc()) });
        },
        commands: { focus, focusAtTrailingEmptyLine: focus },
      }));
      return (
        <div
          ref={dom}
          className="ProseMirror"
          contentEditable
          suppressContentEditableWarning
          tabIndex={-1}
          data-testid="raw-editor"
        >
          {props.rawMd}
        </div>
      );
    }),
  };
});

vi.mock("@syntheo/editor/note", () => ({
  normalizePortableAttachmentUrls: (value: unknown) => value,
}));
vi.mock("./living-document.css", () => ({}));
vi.mock("../title-input", () => ({ TitleInput: () => null }));
vi.mock("./summary-review", () => ({
  useSummaryProposal: () => null,
  SummaryProposalReview: () => null,
}));
vi.mock("./summary-switcher", () => ({ SummarySwitcher: () => null }));
vi.mock("./transcript-margin", () => ({ TranscriptMargin: () => null }));
// Note input chrome that the living document does not show.
vi.mock("../note-input/enhanced", () => ({ Enhanced: () => null }));
vi.mock("../note-input/header", () => ({
  Header: () => null,
  SessionViewSwitcher: () => null,
  useEditorTabs: () => [{ type: "raw" }],
}));
vi.mock("../note-input/transcript", () => ({ Transcript: () => null }));
vi.mock("../note-input/search/bar", () => ({ SearchBar: () => null }));
vi.mock("~/stt/contexts", () => ({ useListener: () => "inactive" }));
vi.mock("~/ai/hooks", () => ({ useAITaskTask: () => ({ status: "idle" }) }));
vi.mock("~/session/editor-activity", () => ({
  registerCanonicalSessionEditor: vi.fn(),
  unregisterCanonicalSessionEditor: vi.fn(),
}));
vi.mock(
  "~/session/components/outer-header/metadata/participants/input",
  () => ({ ParticipantInput: () => null }),
);
vi.mock("~/shared/config", () => ({ useConfigValue: () => ["fr"] }));
vi.mock("~/templates/use-open-templates-tab", () => ({
  useOpenTemplatesTab: () => vi.fn(),
}));
vi.mock("~/templates", () => {
  const templates = [
    { id: "default-daily-standup", title: "Point quotidien", sections: [] },
    { id: "default-one-on-one-meeting", title: "Tête-à-tête", sections: [] },
  ];
  return {
    useUserTemplates: () => templates,
    useUserTemplate: (id: string | null) => ({
      data: templates.find((template) => template.id === id) ?? null,
    }),
  };
});

const MIGRATIONS = resolve(process.cwd(), "../../crates/db-app/migrations");
let schema = "";

const tab = {
  type: "sessions",
  id: "session-1",
  active: true,
  pinned: false,
  slotId: "slot-1",
  state: { view: null, autoStart: null },
} as Extract<Tab, { type: "sessions" }>;

function Harness({ stage }: { stage: NoteStage }) {
  return (
    <NoteInput
      tab={tab}
      stage={stage}
      sessionMode={stage === "listen" ? "active" : "inactive"}
      rawMd=""
      sessionTitle="Point d'équipe"
      editorTabs={[{ type: "raw" }]}
      currentTab={{ type: "raw" }}
      handleTabChange={vi.fn()}
    />
  );
}

// A mouse click as the browser delivers it: the click lands on whatever is
// still under the pointer when the button is released.
function clickLikeBrowser(element: Element) {
  fireEvent.pointerDown(element, { button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  const target = element.isConnected ? element : document.body;
  fireEvent.pointerUp(target, { button: 0 });
  fireEvent.mouseUp(target, { button: 0 });
  fireEvent.click(target, { button: 0 });
}

function storedTemplateId() {
  const [row] = query(
    "SELECT COALESCE(template_id, '') AS template_id FROM session_documents WHERE id = 'session-1' AND kind = 'note'",
  ) as Array<{ template_id: string }>;
  return row?.template_id;
}

async function chooseMeetingType(name: string) {
  clickLikeBrowser(screen.getByRole("button", { name: /Meeting type/ }));
  clickLikeBrowser(
    await screen.findByRole("option", { name: new RegExp(name) }),
  );
  await waitFor(() => expect(storedTemplateId()).toBeDefined());
}

describe("meeting type selection on the real schema", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= vi.fn();
    schema = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(resolve(MIGRATIONS, name), "utf8"))
      .join("\n");
  });
  beforeEach(() => {
    const database = new DatabaseSync(":memory:");
    database.exec(schema);
    database.exec(
      "INSERT INTO sessions (id, owner_user_id, title) VALUES ('session-1', 'user-1', 'Point d''équipe')",
    );
    mocks.database = database;
    mocks.editorText = "";
  });
  afterEach(() => {
    cleanup();
    mocks.listeners.clear();
  });

  it("keeps the chosen type through a reread, the note autosave and listening", async () => {
    const view = render(<Harness stage="prepare" />);
    await chooseMeetingType("Point quotidien");

    await waitFor(() =>
      expect(storedTemplateId()).toBe("default-daily-standup"),
    );
    expect(
      screen.getByRole("button", { name: "Meeting type: Point quotidien" }),
    ).toBeTruthy();

    // The note editor autosaves right after (debounced typing).
    mocks.editorText = "Ordre du jour";
    await act(() =>
      updateSession("session-1", {
        raw_md: JSON.stringify({ type: "doc", content: [] }),
      }),
    );
    expect(storedTemplateId()).toBe("default-daily-standup");

    // Listening starts: the fiche gives way to the note meta.
    view.rerender(<Harness stage="listen" />);
    expect(await screen.findByText("Point quotidien")).toBeTruthy();
    view.rerender(<Harness stage="prepare" />);
    expect(
      screen.getByRole("button", { name: "Meeting type: Point quotidien" }),
    ).toBeTruthy();
  });

  it("stores the type of a brand-new session whose note does not exist yet", async () => {
    expect(storedTemplateId()).toBeUndefined();
    render(<Harness stage="prepare" />);
    await chooseMeetingType("Tête-à-tête");
    await waitFor(() =>
      expect(storedTemplateId()).toBe("default-one-on-one-meeting"),
    );
  });

  it("returns to Automatic only when Automatic is chosen", async () => {
    render(<Harness stage="prepare" />);
    await chooseMeetingType("Point quotidien");
    await waitFor(() =>
      expect(storedTemplateId()).toBe("default-daily-standup"),
    );
    await chooseMeetingType("Automatic");
    await waitFor(() => expect(storedTemplateId()).toBe(""));
  });
});
