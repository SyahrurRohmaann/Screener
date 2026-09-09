import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as typeof Module & {
  _load: (id: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
};

// Intercept before loading either entry point so real session/store modules never run.
async function withMocks(path: string, mocks: Record<string, unknown>, run: (entry: any) => Promise<void>) {
  const filename = require.resolve(path);
  const cached = require.cache[filename];
  const originalLoad = loader._load;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  delete require.cache[filename];
  loader._load = function (id, parent, isMain) {
    if (parent?.filename === filename && Object.hasOwn(mocks, id)) return mocks[id];
    return originalLoad.call(this, id, parent, isMain);
  };
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("Unexpected network access");
  };
  try {
    await run(require(path));
    assert.equal(fetchCalls, 0, "entry point must not access the network");
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
    delete require.cache[filename];
    if (cached) require.cache[filename] = cached;
  }
}

test("reverse API denies unauthenticated requests before history, comparison, or fetch", async () => {
  const calls: string[] = [];
  const denied = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  await withMocks("../api/reverse/route", {
    "../../lib/session": { guard: async () => { calls.push("guard"); return denied; } },
    "../../lib/store": { readHistory: async () => { calls.push("history"); return []; } },
    "../../lib/reverse": { compareReverse: async () => { calls.push("compare"); return {}; } },
  }, async ({ GET }) => {
    for (const range of ["30", "invalid"]) {
      calls.length = 0;
      const response = await GET(new Request(`http://localhost/api/reverse?range=${range}`));
      assert.equal(response, denied);
      assert.equal(response.status, 401);
      assert.deepEqual(calls, ["guard"]);
    }
    assert.deepEqual(await denied.json(), { error: "Unauthorized" });
  });
});

test("authenticated reverse API passes isolated history and range to comparison", async () => {
  const calls: string[] = [];
  const history = [{ key: "synthetic-history" }];
  const comparison = { evidence: "RETROSPECTIVE_REPLAY", total: 1, rows: [] };
  let expectedRange = "30";
  await withMocks("../api/reverse/route", {
    "../../lib/session": { guard: async () => { calls.push("guard"); return null; } },
    "../../lib/store": { readHistory: async () => { calls.push("history"); return history; } },
    "../../lib/reverse": { compareReverse: async (records: unknown, range: string) => {
      calls.push("compare");
      assert.equal(records, history);
      assert.equal(range, expectedRange);
      return comparison;
    } },
  }, async ({ GET }) => {
    for (const query of ["", "?range=60", "?range=90", "?range=all"]) {
      expectedRange = query ? query.split("=")[1] : "30";
      calls.length = 0;
      const response = await GET(new Request(`http://localhost/api/reverse${query}`));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.deepEqual(await response.json(), comparison);
      assert.deepEqual(calls, ["guard", "history", "compare"]);
    }
  });
});

test("reverse page redirects unauthenticated visitors before rendering", async () => {
  const calls: string[] = [];
  const redirected = new Error("Mock redirect");
  const render = () => { calls.push("render"); throw new Error("Unexpected render"); };
  await withMocks("../reverse/page", {
    "../lib/session": { currentSession: async () => { calls.push("session"); return null; } },
    "next/navigation": { redirect: (url: string) => {
      calls.push("redirect");
      assert.equal(url, "/login?next=%2Freverse");
      throw redirected;
    } },
    "next/link": { default: render },
    "../components/auth/AccountPanel": { default: render },
    "../components/ReverseReplay": { default: render },
    "react": { createElement: render },
    "react/jsx-runtime": { jsx: render, jsxs: render },
    "react/jsx-dev-runtime": { jsxDEV: render },
    "./reverse.css": {},
  }, async ({ default: ReversePage }) => {
    await assert.rejects(() => ReversePage(), error => error === redirected);
    assert.deepEqual(calls, ["session", "redirect"]);
  });
});
