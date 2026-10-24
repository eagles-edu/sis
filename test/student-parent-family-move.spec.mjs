import assert from "node:assert/strict"
import test from "node:test"
import { reconcileParentPortalStudentLinks } from "../src/modules/admin/student-write-import.mjs"

test("moving a student into an existing parent family reuses that account link", async () => {
  const calls = []
  const prisma = {
    studentProfile: {
      findMany: async () => [{ studentRefId: "student-misa" }, { studentRefId: "student-sibling" }],
    },
    parentPortalStudentLink: {
      upsert: async (args) => {
        calls.push({ method: "link.upsert", args })
      },
      deleteMany: async (args) => {
        calls.push({ method: "link.deleteMany", args })
      },
    },
    parentPortalAccount: {
      findUnique: async ({ where }) => where.parentsId === "cmtin001" ? { id: "account-tin" } : null,
      update: async (args) => {
        calls.push({ method: "account.update", args })
      },
    },
  }

  await reconcileParentPortalStudentLinks(prisma, {
    studentRefId: "student-misa",
    parentsId: "cmtin001",
    familyId: "fam-0125",
  })

  assert.deepEqual(calls.map(({ method }) => method), [
    "link.upsert",
    "link.deleteMany",
    "link.upsert",
    "link.deleteMany",
  ])
  assert.deepEqual(calls[0].args.create, {
    parentAccountId: "account-tin",
    studentRefId: "student-misa",
  })
  assert.deepEqual(calls[1].args.where, {
    studentRefId: "student-misa",
    parentAccountId: { not: "account-tin" },
  })
  assert.deepEqual(calls[2].args.create, {
    parentAccountId: "account-tin",
    studentRefId: "student-sibling",
  })
  assert.deepEqual(calls[3].args.where, {
    studentRefId: "student-sibling",
    parentAccountId: { not: "account-tin" },
  })
})

test("renaming a sole linked parent account still works when the target ID is unused", async () => {
  const updates = []
  const prisma = {
    parentPortalStudentLink: {
      findMany: async () => [{ parentAccountId: "account-misa" }],
    },
    parentPortalAccount: {
      findUnique: async () => null,
      update: async (args) => updates.push(args),
    },
  }

  await reconcileParentPortalStudentLinks(prisma, {
    studentRefId: "student-misa",
    parentsId: "cmnew001",
  })

  assert.deepEqual(updates, [{
    where: { id: "account-misa" },
    data: { parentsId: "cmnew001" },
  }])
})
