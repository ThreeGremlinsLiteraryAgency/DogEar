import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const env = {
  ALLOWED_ORIGIN: "https://threegremlinsliteraryagency.github.io",
  CATALOG_DB: {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() { return { results: [{work_key:"OL1W",title:"Sample",subjects_json:"[]",author_names:"Example Author"}] }; },
            async first() { return {work_key:args[0],title:"Sample"}; }
          };
        }
      };
    }
  }
};

function request(path, options = {}) {
  return new Request("https://catalog.example" + path, options);
}

test("health responds without exposing private data", async () => {
  const response = await worker.fetch(request("/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok:true,service:"paper-gremlin-catalog"});
});

test("search returns normalized book results", async () => {
  const response = await worker.fetch(request("/search?q=sample"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.books[0].title, "Sample");
  assert.deepEqual(body.books[0].author_names, ["Example Author"]);
  assert.deepEqual(body.books[0].subjects, []);
});

test("search ignores too-short queries", async () => {
  const response = await worker.fetch(request("/search?q=a"), env);
  assert.deepEqual(await response.json(), {books:[],total:0});
});

test("rejects unsupported methods and malformed work identifiers", async () => {
  assert.equal((await worker.fetch(request("/search", {method:"POST"}), env)).status, 405);
  assert.equal((await worker.fetch(request("/works/not-a-work"), env)).status, 400);
  assert.equal((await worker.fetch(request("/unknown"), env)).status, 404);
});

test("allows the configured website origin", async () => {
  const response = await worker.fetch(request("/health", {headers:{Origin: env.ALLOWED_ORIGIN}}), env);
  assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
});

test("does not allow arbitrary browser origins", async () => {
  const response = await worker.fetch(request("/health", {headers:{Origin:"https://other.example"}}), env);
  assert.notEqual(response.headers.get("access-control-allow-origin"), "https://other.example");
});

test("allows CORS preflight from the website", async () => {
  const response = await worker.fetch(request("/search", {method:"OPTIONS", headers:{Origin:env.ALLOWED_ORIGIN}}), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
});
