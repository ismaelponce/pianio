// @ts-expect-error The content pipeline is an importable JavaScript module.
import { loadContent, compileMusic, buildCatalog } from "../../../../scripts/lib/content-pipeline.mjs";
import { describe, expect, it, vi } from "vitest";
import { createCatalogLoader, validateCatalog, visibleCatalog } from "./catalogLoader";
import { catalogFixture, deferred } from "./catalogFixture";

const response = (value: unknown) => new Response(JSON.stringify(value));
describe("catalog loader", () => {
  it("fetches only the configured source catalog and caches the response", async () => {
    const fetcher = vi.fn(async () => response(catalogFixture("en")));
    const loader = createCatalogLoader(fetcher);
    const first = await loader.load("en");
    expect(await loader.load("en")).toBe(first);
    expect(fetcher.mock.calls).toEqual([["/generated/en/catalog.json"]]);
  });

  it("deduplicates pending loads and filters aggregate courses without mutating the catalog", async () => {
    const wait = deferred<Response>();
    const canonical = catalogFixture("en");
    canonical.courses.push({ ...canonical.courses[0], id: "method-level-1", exercises: canonical.courses[0].exercises.map(e => ({ ...e, scorePath: e.scorePath.replace("method-level-1a", "method-level-1") })) });
    const fetcher = vi.fn().mockReturnValueOnce(wait.promise);
    const loader = createCatalogLoader(fetcher);
    const first = loader.load("en"), second = loader.load("en");
    expect(first).toBe(second);
    wait.resolve(response(canonical));
    const data = await first;
    expect(visibleCatalog(data).courses).toHaveLength(1);
    expect(data.courses).toHaveLength(2);
    expect(await loader.load("en")).toBe(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    () => new Response("unavailable", { status: 503 }),
    () => new Response('{"locale":'),
    () => new Response("<!doctype html><html><body>SPA</body></html>", { headers: { "content-type": "text/html" } }),
    () => response({ ...catalogFixture("en"), locale: "fr" }),
  ])("rejects failed or malformed source catalogs and allows retry", async badResponse => {
    const fetcher = vi.fn().mockResolvedValueOnce(badResponse()).mockResolvedValueOnce(response(catalogFixture("en")));
    const loader = createCatalogLoader(fetcher);
    await expect(loader.load("en")).rejects.toThrow();
    await expect(loader.load("en")).resolves.toMatchObject({ locale: "en" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects unsafe paths, duplicate IDs, malformed music and dishonest coverage", () => {
    for (const mutate of [
      (c: ReturnType<typeof catalogFixture>) => { c.courses[0].exercises[0].scorePath = "https://evil.example/score"; },
      (c: ReturnType<typeof catalogFixture>) => { c.courses[0].id = "../escape"; },
      (c: ReturnType<typeof catalogFixture>) => { c.courses[0].exercises[1].id = c.courses[0].exercises[0].id; },
      (c: ReturnType<typeof catalogFixture>) => { c.courses[0].exercises[0].expectedNotes[0].noteNumber = 128; },
      (c: ReturnType<typeof catalogFixture>) => { c.courses[0].coverage.fallbackFields = 2; },
    ]) {
      const c = catalogFixture("en"); mutate(c);
      expect(() => validateCatalog(c, "en")).toThrow();
    }
  });

  it("builds and validates the generated source catalog", async () => {
    const content = await loadContent({ rootDir: "../.." });
    const music = compileMusic(content.courses);
    const data = buildCatalog(content, "en", music);
    expect(validateCatalog(data, "en").courses).toHaveLength(80);
  });
});
