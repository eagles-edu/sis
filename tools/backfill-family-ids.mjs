import { getSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"

const APPLY = process.argv.includes("--apply")
const FAMILY_ID_RE = /^fam-(\d{4,})$/i
const normalize = (value) => String(value ?? "").trim()
const lower = (value) => normalize(value).toLowerCase()

const prisma = await getSharedPrismaClient()
try {
  const profiles = await prisma.studentProfile.findMany({
    select: { studentRefId: true, familyId: true, parentsId: true },
    orderBy: { studentRefId: "asc" },
  })
  const groups = new Map()
  const blocked = []
  for (const profile of profiles) {
    const parentsId = lower(profile.parentsId)
    if (!parentsId) {
      blocked.push({ studentRefId: profile.studentRefId, reason: "missing parentsId" })
      continue
    }
    const group = groups.get(parentsId) || []
    group.push(profile)
    groups.set(parentsId, group)
  }

  const existingFamilies = await prisma.family.findMany({ select: { familyId: true, sequence: true } })
  const usedSequences = new Set(existingFamilies.map((row) => row.sequence))
  let nextSequence = Math.max(0, ...existingFamilies.map((row) => row.sequence || 0))
  const assignments = []
  const conflicts = []
  for (const [parentsId, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const generatedIds = [...new Set(group.map((row) => normalize(row.familyId)).filter((value) => FAMILY_ID_RE.test(value)))]
    if (generatedIds.length > 1) {
      conflicts.push({ parentsId, reason: "one parentsId has multiple generated family IDs", familyIds: generatedIds })
      continue
    }
    let familyId = generatedIds[0] || ""
    let sequence = familyId ? Number.parseInt(familyId.match(FAMILY_ID_RE)[1], 10) : 0
    if (!familyId) {
      do { nextSequence += 1 } while (usedSequences.has(nextSequence))
      sequence = nextSequence
      familyId = `fam-${String(sequence).padStart(4, "0")}`
    }
    if (usedSequences.has(sequence) && !existingFamilies.some((row) => row.familyId === familyId && row.sequence === sequence)) {
      conflicts.push({ parentsId, reason: "generated family sequence is already assigned to another family", familyId, sequence })
      continue
    }
    usedSequences.add(sequence)
    assignments.push({ parentsId, familyId, sequence, studentRefIds: group.map((row) => row.studentRefId) })
  }

  const updates = assignments.flatMap((assignment) => assignment.studentRefIds.map((studentRefId) => ({ studentRefId, familyId: assignment.familyId })))
  const changed = updates.filter((update) => {
    const profile = profiles.find((row) => row.studentRefId === update.studentRefId)
    return normalize(profile?.familyId) !== update.familyId
  })
  const report = {
    mode: APPLY ? "apply" : "dry-run",
    profiles: profiles.length,
    safeParentGroups: assignments.length,
    safeProfiles: updates.length,
    changedProfiles: changed.length,
    blockedProfiles: blocked,
    conflicts,
    familyAssignments: assignments.map(({ parentsId, familyId, sequence, studentRefIds }) => ({ parentsId, familyId, sequence, students: studentRefIds.length })),
  }

  if (APPLY) {
    await prisma.$transaction(async (tx) => {
      for (const assignment of assignments) {
        await tx.family.upsert({
          where: { familyId: assignment.familyId },
          update: { sequence: assignment.sequence },
          create: { familyId: assignment.familyId, sequence: assignment.sequence },
        })
        await tx.studentProfile.updateMany({
          where: { studentRefId: { in: assignment.studentRefIds } },
          data: { familyId: assignment.familyId },
        })
      }
    })
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await prisma.$disconnect()
}
