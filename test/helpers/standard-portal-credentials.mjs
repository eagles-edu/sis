import { verifyScryptPassword } from "../../src/modules/admin/users.mjs"

export const STANDARD_STUDENT_LOGIN = "mark001"
export const STANDARD_PARENT_LOGIN = "cmmark001"

function parseAccounts(values, key) {
  const raw = values[key]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    throw new Error(`${key} must contain a JSON array; credential values are omitted`)
  }
}

function configuredCredentials(user, pass, expectedUser) {
  return user === expectedUser && typeof pass === "string" && pass.length > 0
    ? { user: expectedUser, pass }
    : { user: "", pass: "" }
}

export function resolveStandardStudentCredentials(values = {}) {
  const direct = configuredCredentials(
    values.STUDENT_STUDENT_USER,
    values.STUDENT_STUDENT_PASS,
    STANDARD_STUDENT_LOGIN,
  )
  if (direct.user) return direct

  const account = parseAccounts(values, "STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON").find(
    (entry) =>
      entry?.eaglesId === STANDARD_STUDENT_LOGIN &&
      typeof entry.password === "string" &&
      entry.password.length > 0 &&
      String(entry.status || "active").toLowerCase() !== "inactive",
  )
  return account
    ? { user: STANDARD_STUDENT_LOGIN, pass: account.password }
    : { user: "", pass: "" }
}

export function resolveStandardParentCredentials(values = {}) {
  const direct = configuredCredentials(
    values.STUDENT_PARENT_USER,
    values.STUDENT_PARENT_PASS,
    STANDARD_PARENT_LOGIN,
  )
  if (direct.user) return direct

  const directPass = typeof values.STUDENT_PARENT_PASS === "string"
    ? values.STUDENT_PARENT_PASS
    : ""
  const account = parseAccounts(values, "STUDENT_PARENT_PORTAL_ACCOUNTS_JSON").find(
    (entry) =>
      (entry?.parentsId || entry?.username) === STANDARD_PARENT_LOGIN &&
      ((typeof entry.password === "string" && entry.password.length > 0) ||
        (typeof entry.passwordHash === "string" && entry.passwordHash.length > 0)) &&
      String(entry.status || "active").toLowerCase() !== "inactive",
  )
  if (typeof account?.password === "string" && account.password.length > 0) {
    return { user: STANDARD_PARENT_LOGIN, pass: account.password }
  }
  if (
    account?.passwordHash &&
    directPass &&
    verifyScryptPassword(directPass, account.passwordHash)
  ) {
    return { user: STANDARD_PARENT_LOGIN, pass: directPass }
  }
  return { user: "", pass: "" }
}
