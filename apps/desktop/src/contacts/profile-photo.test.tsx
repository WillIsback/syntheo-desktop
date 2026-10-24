import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./shared", () => ({ ContactFacehash: () => <span>No photo</span> }));
vi.mock("./contact-avatar", () => ({
  ContactImage: ({ src }: { src: string }) => <img src={src} alt="Profile" />,
  AvatarUploadButton: ({
    children,
    onUpload,
  }: {
    children: React.ReactNode;
    onUpload: (value: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onUpload("data:image/jpeg;base64,bmV3")}
    >
      {children}Change photo
    </button>
  ),
}));
import { ProfilePhoto } from "./profile-photo";

function view(
  localPhoto: string | null,
  onSave = vi.fn().mockResolvedValue(undefined),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ProfilePhoto
        userId="owner-1"
        name="Ada"
        localPhoto={localPhoto}
        onSave={onSave}
      />
    </QueryClientProvider>,
  );
  return { onSave };
}
afterEach(cleanup);

// Aucun module d'authentification simulé : la photo de profil est locale.
it("saves photo changes locally without any account", async () => {
  const { onSave } = view(null);
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Change photo/ }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith("data:image/jpeg;base64,bmV3"),
  );
  expect(screen.getByRole("img").getAttribute("src")).toBe(
    "data:image/jpeg;base64,bmV3",
  );
});

it("removes the local photo", async () => {
  const { onSave } = view("data:image/jpeg;base64,bGVnYWN5");
  fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
});

it("keeps a failed local save available to retry", async () => {
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined);
  view(null, onSave);
  fireEvent.click(screen.getByRole("button", { name: /Change photo/ }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(onSave).toHaveBeenCalledTimes(2);
});
