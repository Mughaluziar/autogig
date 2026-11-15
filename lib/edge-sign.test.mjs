import assert from "node:assert/strict";
import test from "node:test";
import { EDGE_HEADERS, clientIpFrom, decodePath, signEdge } from "./edge-sign.mjs";

// Vector computed with backend/app/edge.py sign(): the two implementations must agree byte for byte.
const VECTOR = { secret: "s".repeat(40), ts: "1760000000", method: "POST", path: "/api/auth/login", ip: "203.0.113.7", nonce: "n".repeat(32) };

test("signature matches the Python implementation", async () => {
  const sig = await signEdge(VECTOR.secret, VECTOR.ts, VECTOR.method, VECTOR.path, VECTOR.ip, VECTOR.nonce);
  assert.equal(sig, "8e59b114015e3636f22308e735ff0f2b48bdc71df88c360b9f9f8d84dfb8479c");
});

test("method case does not matter, other inputs do", async () => {
  const a = await signEdge("k".repeat(40), "1", "post", "/api/x", "1.1.1.1", "n1");
  assert.equal(a, await signEdge("k".repeat(40), "1", "POST", "/api/x", "1.1.1.1", "n1"));
  for (const other of [["2", "POST", "/api/x", "1.1.1.1", "n1"], ["1", "GET", "/api/x", "1.1.1.1", "n1"], ["1", "POST", "/api/y", "1.1.1.1", "n1"], ["1", "POST", "/api/x", "1.1.1.2", "n1"], ["1", "POST", "/api/x", "1.1.1.1", "n2"]]) {
    assert.notEqual(a, await signEdge("k".repeat(40), ...other));
  }
  assert.notEqual(a, await signEdge("j".repeat(40), "1", "POST", "/api/x", "1.1.1.1", "n1"));
});

test("client address preference and header names", () => {
  const h = (o) => new Headers(o);
  assert.equal(clientIpFrom(h({ "x-vercel-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "3.3.3.3", "x-forwarded-for": "4.4.4.4" })), "1.1.1.1");
  assert.equal(clientIpFrom(h({ "x-real-ip": "3.3.3.3", "x-forwarded-for": "4.4.4.4" })), "3.3.3.3");
  assert.equal(clientIpFrom(h({ "x-forwarded-for": " 4.4.4.4 , 5.5.5.5" })), "4.4.4.4");
  assert.equal(clientIpFrom(h({})), "");
  assert.deepEqual(EDGE_HEADERS, ["x-edge-ts", "x-edge-ip", "x-edge-nonce", "x-edge-sig"]);
});

test("path decoding tolerates bad escapes", () => {
  assert.equal(decodePath("/api/a%20b"), "/api/a b");
  assert.equal(decodePath("/api/%E0%A4%A"), "/api/%E0%A4%A");
});
