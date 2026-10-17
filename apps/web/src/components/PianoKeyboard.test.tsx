import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initializeI18n } from "../i18n";
import { PianoKeyboard } from "./PianoKeyboard";

describe("PianoKeyboard note labels", () => {
  it("shows the source-language note labels", async () => {
    await initializeI18n("en");
    render(<PianoKeyboard />);
    expect(screen.getByText("C2")).toBeTruthy();
  });
});
