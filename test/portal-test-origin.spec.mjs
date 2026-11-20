import assert from "node:assert/strict"
import test from "node:test"
import { resolvePortalTestOrigin } from "./helpers/portal-test-origin.mjs"

test("portal browser tests default to the local API owned by their environment", () => {
  assert.equal(resolvePortalTestOrigin({ environment: {
    NODE_ENV: "development",
    SIS_ENV_FILE: ".env.dev",
    DOTENV_CONFIG_PATH: ".env.dev",
  } }), "http://127.0.0.1:8788")
  assert.equal(resolvePortalTestOrigin({ environment: {
    NODE_ENV: "test",
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.test",
  } }), "http://127.0.0.1:8786")
})

test("portal browser tests reject cross-environment origin overrides and mismatched env files", () => {
  const testEnvironment = {
    NODE_ENV: "test",
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.test",
  }
  assert.equal(resolvePortalTestOrigin({ environment: {
    ...testEnvironment,
    PORTAL_ORIGIN: "https://test.eagles.edu.vn/student",
  }, overrideName: "PORTAL_ORIGIN" }), "https://test.eagles.edu.vn")
  assert.throws(() => resolvePortalTestOrigin({ environment: {
    ...testEnvironment,
    PORTAL_ORIGIN: "http://127.0.0.1:8788",
  }, overrideName: "PORTAL_ORIGIN" }), /does not belong/u)
  assert.throws(() => resolvePortalTestOrigin({ environment: {
    ...testEnvironment,
    DOTENV_CONFIG_PATH: ".env.dev",
  } }), /matching explicit/u)
})
