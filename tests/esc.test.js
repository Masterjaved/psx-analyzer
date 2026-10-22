const test = require("node:test");
const assert = require("node:assert");
const { escapeHtml, safeUrl } = require("../public/esc.js");

test("escapeHtml neutralises markup and quotes", () => {
  assert.strictEqual(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.strictEqual(escapeHtml("Tom & 'Jerry'"), "Tom &amp; &#39;Jerry&#39;");
});

test("escapeHtml handles null/undefined/numbers", () => {
  assert.strictEqual(escapeHtml(null), "");
  assert.strictEqual(escapeHtml(undefined), "");
  assert.strictEqual(escapeHtml(12.5), "12.5");
});

test("safeUrl only allows http(s)", () => {
  assert.strictEqual(safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.strictEqual(safeUrl("javascript:alert(1)"), "");
  assert.strictEqual(safeUrl("data:text/html,<script>1</script>"), "");
  assert.strictEqual(safeUrl("not a url"), "");
  assert.strictEqual(safeUrl(undefined), "");
});
