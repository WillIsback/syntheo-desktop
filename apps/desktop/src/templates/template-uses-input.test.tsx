import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/settings/queries", () => ({ useSetSettingValue: () => vi.fn() }));
vi.mock("~/shared/config", () => ({ useConfigValue: () => "" }));

import { TemplateUsesInput } from "./template-form";

afterEach(cleanup);

describe("TemplateUsesInput (« Utilisé pour »)", () => {
  it("affiche les usages existants (anciens tags)", () => {
    render(
      <TemplateUsesInput value={["Hebdo", "Équipe RH"]} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("group", { name: "Used for" })).toBeTruthy();
    expect(screen.getByText("Hebdo")).toBeTruthy();
    expect(screen.getByText("Équipe RH")).toBeTruthy();
  });

  it("ajoute des usages séparés par des virgules", () => {
    const onChange = vi.fn();
    render(<TemplateUsesInput value={["Hebdo"]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    const input = screen.getByRole("textbox", { name: "Add a use" });
    fireEvent.change(input, { target: { value: "1:1, Manager" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["Hebdo", "1:1", "Manager"]);
  });

  it("retire un usage", () => {
    const onChange = vi.fn();
    render(<TemplateUsesInput value={["Hebdo", "RH"]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Hebdo" }));

    expect(onChange).toHaveBeenCalledWith(["RH"]);
  });
});
