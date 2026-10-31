import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ownerId: "account-1",
  save: vi.fn(),
  contact: {
    data: null as Record<string, unknown> | null | undefined,
    isLoading: false,
    error: null as Error | null,
  },
  query: vi.fn(),
}));
vi.mock("~/shared/owner-user", () => ({
  useOwnerUserId: () => mocks.ownerId,
}));
vi.mock("~/contacts/queries", () => ({
  usePersonalContact: (id: string) => {
    mocks.query(id);
    return mocks.contact;
  },
  useOrganizations: () => [{ id: "company-1", name: "Acme" }],
  savePersonalContact: mocks.save,
}));
vi.mock("~/contacts/shared", () => ({ ContactFacehash: () => null }));
vi.mock("~/contacts/contact-avatar", () => ({
  ContactImage: () => <img alt="Profile" />,
  AvatarUploadButton: ({ onUpload }: { onUpload: (value: string) => void }) => (
    <button
      type="button"
      onClick={() => onUpload("data:image/jpeg;base64,photo")}
    >
      Change photo
    </button>
  ),
}));
vi.mock("~/contacts/details", () => ({
  ContactOrganizationSelector: ({
    onChange,
    disabled,
  }: {
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange("company-1")}
    >
      Choose company
    </button>
  ),
}));
import { AccountProfile } from "./account-profile";

function view() {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <AccountProfile />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ownerId = "account-1";
  mocks.contact = { data: null, isLoading: false, error: null };
  mocks.save.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("saves the contact fields and photo to the local owner's personal card", async () => {
  mocks.contact.data = {
    email: "kept@example.com",
    phone: "+33 6 12 34 56 78",
    linkedinUsername: "kept",
  };
  render(view());
  expect(mocks.query).toHaveBeenCalledWith("account-1");
  // Aucun compte : rien n'est prérempli depuis un profil hébergé.
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  for (const [label, value] of [
    ["Name", "Ada Lovelace"],
    ["Job Title", "Engineer"],
    ["Notes", "My notes"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Choose company" }));
  fireEvent.click(screen.getByRole("button", { name: "Change photo" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith("account-1", {
      name: "Ada Lovelace",
      jobTitle: "Engineer",
      // Champs retirés du formulaire : les valeurs déjà enregistrées sont
      // conservées telles quelles, jamais effacées.
      email: "kept@example.com",
      phone: "+33 6 12 34 56 78",
      linkedinUsername: "kept",
      memo: "My notes",
      organizationId: "company-1",
      avatarDataUrl: "data:image/jpeg;base64,photo",
    }),
  );
  expect(await screen.findByText("Saved")).toBeTruthy();
});

it("preserves a failed draft for retry and saves offline info to the local owner", async () => {
  mocks.ownerId = "local-owner";
  mocks.save.mockRejectedValueOnce(new Error("Database unavailable"));
  render(view());
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Local name" },
  });
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
    "Local name",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save).toHaveBeenLastCalledWith(
    "local-owner",
    expect.objectContaining({ name: "Local name" }),
  );
  expect(await screen.findByText("Saved")).toBeTruthy();
});

it("waits for the saved profile and reports read failures without exposing an empty form", () => {
  mocks.contact = { data: undefined, isLoading: true, error: null };
  const { rerender } = render(view());
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  mocks.contact = {
    data: undefined,
    isLoading: false,
    error: new Error("Read failed"),
  };
  rerender(view());
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("keeps autosaves bound to the owner being edited", async () => {
  const { rerender } = render(view());
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "First account draft" },
  });
  mocks.ownerId = "account-2";
  rerender(view());
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  expect(mocks.query).toHaveBeenLastCalledWith("account-2");
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      "account-1",
      expect.objectContaining({ name: "First account draft" }),
    ),
  );
});

it("loads saved contact fields and removes a photo without clearing other details", async () => {
  mocks.contact.data = {
    name: "Saved name",
    email: "saved@example.com",
    phone: "555",
    jobTitle: "Designer",
    linkedinUsername: "saved",
    memo: "Keep these notes",
    organizationId: "company-1",
    avatarDataUrl: "old-photo",
  };
  render(view());
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
    "Saved name",
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith("account-1", {
      ...mocks.contact.data,
      avatarDataUrl: null,
    }),
  );
});

it("ne demande plus l'adresse e-mail, le téléphone ni LinkedIn", () => {
  render(view());
  expect(screen.getByLabelText("Name")).toBeTruthy();
  for (const label of ["Email", "Phone", "LinkedIn"]) {
    expect(screen.queryByLabelText(label)).toBeNull();
  }
});

it("enregistre des champs retirés vides quand le profil est nouveau", async () => {
  render(view());
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Ada" },
  });
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      "account-1",
      expect.objectContaining({ email: "", phone: "", linkedinUsername: "" }),
    ),
  );
});

it("does not replace newer edits when an earlier save finishes", async () => {
  let finishFirst!: () => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishFirst = resolve;
      }),
  );
  const { rerender } = render(view());
  const name = screen.getByLabelText("Name") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "First edit" } });
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  fireEvent.change(name, { target: { value: "Latest edit" } });
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  finishFirst();
  mocks.contact.data = { name: "First edit" };
  rerender(view());
  expect(name.value).toBe("Latest edit");
  expect(mocks.save).toHaveBeenLastCalledWith(
    "account-1",
    expect.objectContaining({ name: "Latest edit" }),
  );
});

it("submits edits immediately even when navigating away without blur", async () => {
  const { unmount } = render(view());
  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "Keep this note" },
  });
  unmount();
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      "account-1",
      expect.objectContaining({ memo: "Keep this note" }),
    ),
  );
});
