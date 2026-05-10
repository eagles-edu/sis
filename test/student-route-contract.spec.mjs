import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const nginxConf = fs.readFileSync(path.join(root, 'deploy/nginx/admin.eagles.edu.vn.conf'), 'utf8')
const liteSpeedConf = fs.readFileSync(path.join(root, 'deploy/litespeed/admin.eagles.edu.vn.vhost.conf'), 'utf8')

test('admin host serves canonical student portal route at /student', () => {
  assert.match(nginxConf, /location = \/student \{/)
  assert.match(nginxConf, /proxy_pass http:\/\/sis_api_upstream\/student;/)
  assert.match(nginxConf, /location = \/student\/ \{\n\s+return 308 \/student;/)
  assert.match(liteSpeedConf, /RewriteRule \^\/student\/\?\$ http:\/\/sis_api\/student \[P,L\]/)
})
