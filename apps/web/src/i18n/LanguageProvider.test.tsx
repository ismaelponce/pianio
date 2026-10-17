import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogFixture } from "../content/catalogFixture";
import { LanguageProvider, useLanguage } from "./LanguageProvider";
import { initializeI18n, i18n } from "./index";

function Probe() {
  const state = useLanguage();
  return <output data-testid="state">{JSON.stringify(state)}</output>;
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!);
afterEach(cleanup);
beforeAll(() => initializeI18n("en"));
beforeEach(async () => { await i18n.changeLanguage("en"); localStorage.clear(); });

describe("language provider", () => {
  it("loads the configured source catalog and synchronizes document metadata", async () => {
    const loader = { load: vi.fn().mockResolvedValue(catalogFixture("en")) };
    render(<LanguageProvider loader={loader} initialLanguage="en"><Probe /></LanguageProvider>);
    await waitFor(() => expect(state()).toMatchObject({ activeLanguage: "en", contentLanguage: "en", pending: false, error: false }));
    expect(document.documentElement.lang).toBe("en");
    expect(loader.load).toHaveBeenCalledWith("en");
  });

  it("preserves the session after a load failure and supports retry", async () => {
    const loader = { load: vi.fn().mockRejectedValueOnce(Error("temporary")).mockResolvedValueOnce(catalogFixture("en")) };
    function RetryProbe() {
      const current = useLanguage();
      return <><output data-testid="retry-state">{JSON.stringify(current)}</output><button onClick={current.retry}>Retry</button></>;
    }
    render(<LanguageProvider loader={loader} initialLanguage="en"><RetryProbe /></LanguageProvider>);
    await waitFor(() => expect(JSON.parse(screen.getByTestId("retry-state").textContent!)).toMatchObject({ pending: false, error: true }));
    await act(async () => { screen.getByRole("button", { name: "Retry" }).click(); });
    await waitFor(() => expect(JSON.parse(screen.getByTestId("retry-state").textContent!)).toMatchObject({ activeLanguage: "en", contentLanguage: "en", pending: false, error: false }));
  });
});
