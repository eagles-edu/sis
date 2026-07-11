import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const script = fs.readFileSync(path.resolve(process.cwd(), "tools/precompress-web-assets.sh"), "utf8")

test("precompress verification uses the established browser user agent", () => {
  assert.match(script, /CURL_BROWSER_USER_AGENT=\$\{CURL_BROWSER_USER_AGENT:-Mozilla\/5\.0/)
  assert.match(script, /curl -A "\$CURL_BROWSER_USER_AGENT" -sS --http2/)
})
