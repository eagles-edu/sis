const ASSIGNMENT_PASSING_SCORE = 82

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function templateItems(template = {}) {
  const bundle = template.assignmentBundleJson && typeof template.assignmentBundleJson === "object"
    ? template.assignmentBundleJson
    : template
  const items = Array.isArray(bundle.items)
    ? bundle.items
    : Array.isArray(template.itemsJson)
      ? template.itemsJson
      : []
  return items.map((item) => ({
    id: text(item?.assignmentTemplateItemId || item?.id),
    title: text(item?.title),
    url: text(item?.url),
  })).filter((item) => item.id)
}

export function assignmentProgress(template = {}, gradeRows = []) {
  const templateId = text(template.id || template.assignmentTemplateId || template.assignmentBundleJson?.assignmentTemplateId)
  const requiredItems = templateItems(template)
  const requiredIds = new Set(requiredItems.map((item) => item.id))
  const firstPassingSubmissionByItem = new Map()

  for (const grade of Array.isArray(gradeRows) ? gradeRows : []) {
    const bundle = grade?.assignmentBundleJson && typeof grade.assignmentBundleJson === "object"
      ? grade.assignmentBundleJson
      : {}
    if (text(bundle.assignmentTemplateId) !== templateId) continue
    const score = Number(grade.score)
    if (!Number.isFinite(score) || score <= ASSIGNMENT_PASSING_SCORE) continue

    const itemId = text(
      bundle.submittedItemId
      || bundle.assignmentTemplateItemId
      || (Array.isArray(bundle.items) && bundle.items.length === 1
        ? bundle.items[0]?.assignmentTemplateItemId || bundle.items[0]?.id
        : ""),
    )
    if (!requiredIds.has(itemId)) continue

    const submittedAt = grade.submittedAt instanceof Date ? grade.submittedAt : new Date(text(grade.submittedAt))
    const submittedTime = Number.isNaN(submittedAt.valueOf()) ? null : submittedAt
    const existing = firstPassingSubmissionByItem.get(itemId)
    if (!existing || (submittedTime && (!existing.submittedAt || submittedTime < existing.submittedAt))) {
      firstPassingSubmissionByItem.set(itemId, { submittedAt: submittedTime })
    }
  }

  const completedItems = requiredItems.filter((item) => firstPassingSubmissionByItem.has(item.id))
  const completedAtValues = completedItems
    .map((item) => firstPassingSubmissionByItem.get(item.id)?.submittedAt)
    .filter((value) => value instanceof Date)
  const completedAt = completedItems.length === requiredItems.length && completedAtValues.length === requiredItems.length
    ? new Date(Math.max(...completedAtValues.map((value) => value.valueOf())))
    : null

  return {
    required: requiredItems.length,
    completed: completedItems.length,
    requiredItemIds: requiredItems.map((item) => item.id),
    completedItemIds: completedItems.map((item) => item.id),
    completedAt,
    isComplete: requiredItems.length > 0 && completedItems.length === requiredItems.length,
  }
}

export { ASSIGNMENT_PASSING_SCORE }
