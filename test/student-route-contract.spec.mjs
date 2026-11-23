import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const routeContract = JSON.parse(fs.readFileSync(path.join(root, 'config/test-route-contract.json'), 'utf8'))
const testSyncScript = fs.readFileSync(path.join(root, 'tools/sync-and-restart-test-runtime.sh'), 'utf8')

test('test mirror serves the canonical student route and redirects its legacy alias', () => {
  assert.equal(routeContract.studentPortalPagePath, '/student')
  assert.equal(routeContract.studentLegacyPagePath, '/student/portal')
  const studentRoute = routeContract.checks.find((route) => route.path === '/student')
  const studentLegacyRoute = routeContract.checks.find((route) => route.path === '/student/portal')
  assert.deepEqual(studentRoute, { path: '/student', status: 200, needle: 'Student Portal' })
  assert.deepEqual(studentLegacyRoute, { path: '/student/portal', status: 308, location: '/student' })
  assert.ok(testSyncScript.includes('[`http://127.0.0.1:${port}${contract.studentLegacyPagePath || "/student/portal"}`, 308, "", studentPortalPagePath]'))
  assert.match(testSyncScript, /contract\.studentPortalPagePath \|\| "\/student"/)
})
