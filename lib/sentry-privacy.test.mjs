import assert from "node:assert/strict";
import test from "node:test";
import { scrubEvent, sentryPrivacy } from "./sentry-privacy.ts";

test("nothing personal is collected by configuration", () => {
  const d = sentryPrivacy.dataCollection;
  assert.equal(d.userInfo, false); assert.equal(d.cookies, false); assert.equal(d.urlQueryParams, false);
  assert.deepEqual(d.httpBodies, []); assert.equal(d.httpHeaders.request, false); assert.equal(d.httpHeaders.response, false);
  assert.equal(d.genAI.inputs, false); assert.equal(d.databaseQueryData, false); assert.equal(d.stackFrameVariables, false);
  assert.equal(sentryPrivacy.sendDefaultPii, false);
});

test("scrubEvent removes user, request body/cookies/headers/query and breadcrumb text", () => {
  const out = scrubEvent({
    user: { email: "a@b.co", ip_address: "1.2.3.4" },
    request: { url: "https://x.test/login?token=abc#frag", data: { password: "p" }, cookies: { s: "1" }, headers: { cookie: "s=1" }, query_string: "token=abc" },
    breadcrumbs: [{ category: "ui.click", message: "clicked Pay for jane@x.co", data: { value: "secret" }, timestamp: 1 }],
    contexts: { user: { email: "a@b.co" }, os: { name: "Linux" } },
    exception: { values: [{ type: "Error", value: "boom" }] },
  });
  assert.equal(out.user, undefined);
  assert.deepEqual(out.request, { url: "https://x.test/login" });
  assert.deepEqual(out.breadcrumbs, [{ category: "ui.click", timestamp: 1 }]);
  assert.deepEqual(out.contexts, { os: { name: "Linux" } });
  assert.equal(out.exception.values[0].value, "boom");                    // the error itself is kept
});
