// Run: node --test scripts/deploy-guards.test.mjs   (also `npm run test:deploy-guards`)
import test from "node:test";
import assert from "node:assert/strict";
const SECRET = "e".repeat(40);
import { deployProblems, enforceDeployGuards } from "./deploy-guards.mjs";

test("a correct production environment has no problems", () => {
  assert.deepEqual(deployProblems({ BACKEND_API_URL: "https://api.example.com", EDGE_SHARED_SECRET: SECRET }), []);
  assert.deepEqual(deployProblems({ NEXT_PUBLIC_API_URL: "https://api.example.com/", EDGE_SHARED_SECRET: SECRET }), []);
});
test("no backend URL would silently ship the unauthenticated demo", () => {
  assert.match(deployProblems({})[0], /frontend-only demo/);
  assert.deepEqual(deployProblems({ ALLOW_FRONTEND_ONLY_DEMO: "true" }), []);          // deliberate demo site
});
test("the dev bypass is refused", () => {
  const p = deployProblems({ BACKEND_API_URL: "https://api.example.com", EDGE_SHARED_SECRET: SECRET, NEXT_PUBLIC_DEV_BYPASS_AUTH: "true" });
  assert.equal(p.length, 1); assert.match(p[0], /DEV_BYPASS_AUTH/);
  assert.deepEqual(deployProblems({ BACKEND_API_URL: "https://api.example.com", EDGE_SHARED_SECRET: SECRET, NEXT_PUBLIC_DEV_BYPASS_AUTH: "false" }), []);
});
test("an http backend is refused and credentials in a URL are not echoed", () => {
  assert.match(deployProblems({ BACKEND_API_URL: "http://api.example.com" })[0], /https/);
  assert.ok(!deployProblems({ BACKEND_API_URL: "http://user:secretpw@api.example.com" })[0].includes("secretpw"));
});
test("guards only apply to production deploys", () => {
  enforceDeployGuards({ VERCEL_ENV: "preview" });                                      // preview/local builds are not blocked
  enforceDeployGuards({});
  assert.throws(() => enforceDeployGuards({ VERCEL_ENV: "production" }), /Refusing to build for production/);
  assert.throws(() => enforceDeployGuards({ ENFORCE_DEPLOY_GUARDS: "true", BACKEND_API_URL: "http://x" }), /https/);
  enforceDeployGuards({ VERCEL_ENV: "production", BACKEND_API_URL: "https://api.example.com", EDGE_SHARED_SECRET: SECRET });
});
test("the edge-proof secret is required with a backend, and a short one is not enough", () => {
  const base = { BACKEND_API_URL: "https://api.example.com" };
  assert.match(deployProblems(base)[0], /EDGE_SHARED_SECRET/);
  assert.match(deployProblems({ ...base, EDGE_SHARED_SECRET: "short" })[0], /EDGE_SHARED_SECRET/);
  assert.deepEqual(deployProblems({ ...base, ALLOW_NO_EDGE_PROOF: "true" }), []);
  assert.ok(!deployProblems({ ...base, EDGE_SHARED_SECRET: "nope" }).join().includes("nope"));
});
