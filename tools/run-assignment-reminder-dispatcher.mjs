#!/usr/bin/env node
// @ts-check

import { runAssignmentReminderDispatcher } from "../src/modules/admin/assignment-reminder-dispatcher.mjs"

const result = await runAssignmentReminderDispatcher()
console.log(JSON.stringify(result))
