#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import XLSX from "xlsx"
import { buildAwlFamilyId, importReferenceCatalog } from "../src/modules/admin/library-reference-catalogs.mjs"

const root = process.cwd()
const publication = path.join(root, "docs/esl/0000000_publication.pdf")
const morphemeSource = path.join(root, "docs/esl/Copy of AWL-awl-vocabulary-suffixes prefixes-pos2.pdf")
const awlSource = path.join(root, "docs/esl/awlsublists1.pdf")
const idiomSource = path.join(root, "docs/esl/engxam.com_ CPE Useful Idioms & Phrases_.xlsx")
const actor = "reference-backfill-2026-08-28"
const sourceUrl = (file, page = "") => `${path.relative(root, file)}${page ? `#page=${page}` : ""}`
const clean = (value) => String(value == null ? "" : value).replace(/[‐‑‒–—]/gu, "-").replace(/\s+/gu, " ").trim()
const unique = (rows) => [...new Map(rows.filter((row) => row.term).map((row) => [`${clean(row.term).toLocaleLowerCase("en-US")}|${clean(row.subtype).toLocaleLowerCase("en-US")}`, row])).values()]

function pdfPages(file, first, last) {
  return execFileSync("pdftotext", ["-f", String(first), "-l", String(last), "-layout", file, "-"], { encoding: "utf8" })
}

function grammarRows() {
  const text = pdfPages(publication, 58, 59)
  const prepBlock = text.split("List of Conjunctions")[0].replace(/^.*List of Prepositions\s*/su, "")
  const prepositions = unique(prepBlock.split(/\s+/u).map((term) => ({ term: term.replace(/[^\p{L}/-]/gu, ""), subtype: "", sourcePage: "58", sourceUrl: sourceUrl(publication, 58), sourceLabel: "0000000 publication" })))
  const conjunctionBlock = text.split("List of Conjunctions")[1].split("Types of Determiners")[0]
  const conjunctionTerms = ["after", "although", "as", "as if", "as long as", "as much as", "as soon as", "as though", "because", "before", "even", "even if", "even though", "if", "if only", "if when", "if then", "inasmuch", "in order that", "just as", "lest", "now", "now since", "now that", "now when", "once", "provided", "provided that", "rather than", "since", "so that", "supposing", "than", "that", "though", "til", "unless", "until", "when", "whenever", "where", "whereas", "where if", "wherever", "whether", "which", "while", "whoever", "why", "for", "and", "nor", "but", "or", "yet", "so"]
  const conjunctions = unique(conjunctionTerms.map((term) => ({ term, subtype: /^(for|and|nor|but|or|yet|so)$/u.test(term) ? "coordinating" : "subordinating", sourcePage: "58", sourceUrl: sourceUrl(publication, 58), sourceLabel: "0000000 publication" })))
  const determiners = unique("a an the my your his her its our their one two three another anybody anyone anything each either enough everybody everyone everything less little much neither nobody no-one nothing other somebody someone something both few fewer many others several all any more most none some such this that these those".split(" ").map((term) => ({ term, subtype: "", sourcePage: "58", sourceUrl: sourceUrl(publication, 58), sourceLabel: "0000000 publication", editorialStatus: "needs_review" })))
  const pronounTerms = ["I", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "mine", "yours", "his", "hers", "ours", "theirs", "myself", "yourself", "himself", "herself", "itself", "ourselves", "yourselves", "themselves", "each other", "another", "anybody", "anyone", "anything", "each", "either", "enough", "everybody", "everyone", "everything", "less", "little", "much", "neither", "nobody", "no-one", "nothing", "one", "other", "somebody", "someone", "something", "both", "few", "fewer", "many", "others", "several", "all", "any", "more", "most", "none", "some", "such", "this", "that", "these", "those", "what", "which", "who", "whom", "whose", "whatever", "whatsoever", "whichever", "whoever", "whosoever", "whomever", "whomsoever", "whosever", "when", "where", "thou", "thee", "thy", "thine", "ye"]
  const pronouns = unique(pronounTerms.map((term) => ({ term, subtype: "", sourcePage: "59", sourceUrl: sourceUrl(publication, 59), sourceLabel: "0000000 publication", editorialStatus: "needs_review" })))
  return { prepositions, conjunctions, determiners, pronouns, conjunctionBlock }
}

function auxiliaryRows() {
  const primary = ["be", "have", "do"]
  const modal = ["can", "could", "will", "would", "shall", "should", "may", "might", "must", "ought (to)", "need", "dare (to)", "have to", "would have", "should have", "could have", "will be able to", "will have to", "be forced (to)", "used to"]
  return [...primary.map((term) => ({ term, subtype: "primary", auxiliaryClass: "primary", sourcePage: "24", sourceUrl: sourceUrl(publication, 24), sourceLabel: "0000000 publication" })), ...modal.map((term) => ({ term, subtype: "modal", auxiliaryClass: "modal", sourcePage: "24", sourceUrl: sourceUrl(publication, 24), sourceLabel: "0000000 publication" }))]
}

function morphemeRows() {
  const rows = []
  for (const [page, subtype] of [[9, "prefix"], [10, "prefix"], [11, "suffix"], [12, "suffix"]]) {
    for (const line of pdfPages(morphemeSource, page, page).split("\n")) {
      const match = line.match(/^\s*([^\s]+)\s{2,}(.+?)\s*$/u)
      if (!match || !/[-]/u.test(match[1]) || /^(Prefix|Suffix|Meaning)/u.test(match[1])) continue
      rows.push({ term: match[1], subtype, meaning: clean(match[2]), sourcePage: String(page), sourceUrl: sourceUrl(morphemeSource, page), sourceLabel: "AWL vocabulary suffixes and prefixes", editorialStatus: "admin" })
    }
  }
  return unique(rows)
}

function awlRows() {
  const families = new Map()
  let sublist = ""
  let familyPosition = 0
  let familyByColumn = [null, null, null]
  for (let page = 1; page <= 26; page += 1) {
    const pageText = pdfPages(awlSource, page, page)
    const title = pageText.match(/Sublist (\d+) of/u)
    if (title) {
      sublist = title[1]
      familyPosition = 0
      familyByColumn = [null, null, null]
    }
    if (!sublist) continue
    for (const line of pageText.split("\n")) {
      if (!line.trim() || /^\s*(Sublists|Each word|Academic Corpus|British|\d+\s*$|\f)/u.test(line)) continue
      const cells = [line.slice(0, 35), line.slice(35, 70), line.slice(70)]
      cells.forEach((cell, column) => {
        const value = clean(cell).replace(/[^\p{L}\p{N}'-].*$/u, "")
        if (!value || value.length < 2 || !/^[\p{L}]/u.test(value)) return
        const isHeadword = !/^\s/u.test(cell)
        if (isHeadword) {
          familyPosition += 1
          const familyId = buildAwlFamilyId(value, sublist, familyPosition)
          familyByColumn[column] = { familyId, headword: value, members: [] }
          families.set(familyId, { term: value, familyId, qualifyingMember: value, sublist, headwordPartOfSpeech: "", headwordSubtype: "", members: [], memberPartOfSpeech: "", memberSubtype: "", sourcePage: String(page), sourceUrl: sourceUrl(awlSource), sourceLabel: "Academic Word List sublists", editorialStatus: "needs_review" })
        } else if (familyByColumn[column]) {
          familyByColumn[column].members.push(value)
          families.get(familyByColumn[column].familyId)?.members.push(value)
        }
      })
    }
  }
  return [...families.values()].map((family) => ({ ...family, members: family.members.join("; ") }))
}

function idiomRows() {
  const workbook = XLSX.read(fs.readFileSync(idiomSource), { type: "buffer", cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
  return unique(rows.map((row, index) => ({ term: clean(row[0]), definition: clean(row[1]), idiomType: "", phraseType: "", sourceSheet: workbook.SheetNames[0], sourceRow: String(index + 1), sourceUrl: sourceUrl(idiomSource), sourceLabel: "CPE Useful Idioms & Phrases workbook", editorialStatus: "needs_review" })).filter((row) => row.term))
}

const grammar = grammarRows()
const imports = [
  ["prepositions", grammar.prepositions], ["conjunctions", grammar.conjunctions], ["determiners", grammar.determiners], ["pronouns", grammar.pronouns], ["auxiliaries", auxiliaryRows()], ["morphemes", morphemeRows()], ["awl", awlRows()], ["idioms", idiomRows()],
]
const summary = []
for (const [catalog, rows] of imports) {
  const result = await importReferenceCatalog(catalog, actor, rows)
  summary.push({ catalog, rows: rows.length, created: result.created, updated: result.updated })
}
console.log(JSON.stringify({ ok: true, source: "docs/esl", summary }, null, 2))
