# Conversion rules

How `POST /api/convert` turns one text format into another (decision F3). The rules for the
ambiguous pairs are fixed here and in `src/modules/transformations/text/text-conversion.spec.ts`.

## Input

- **Source format.** The file's extension decides when it names a text format: `.csv`, `.json`,
  `.xml`, `.yaml` / `.yml`. Without one, the content decides between XML (starts with `<`) and
  JSON (starts with `{` or `[`). CSV and YAML cannot be told apart reliably by content, so
  without their extension the file is refused with 415 `FILE_TYPE_NOT_SUPPORTED`.
- **Encoding.** UTF-8 only; a UTF-8 BOM is accepted and dropped. UTF-16 or invalid UTF-8 → 400
  `FILE_ENCODING_INVALID`. An empty or whitespace-only file → 400 `FILE_EMPTY`.
- **Size.** Per source format, an admin setting (`convert.maxBytes.<format>`, default 10 MB) →
  413 `FILE_TOO_LARGE` with `context.maxBytes` and `context.format`.
- **Limits** (→ 400 `STRUCTURE_TOO_COMPLEX`): at most 64 levels of nesting, 5 000 000 values and
  50 000 000 characters of text in the parsed data — counted as expanded, so YAML aliases or
  repetition cannot amplify a small file; a result of at most 100 000 000 characters; a CSV
  result of at most 10 000 columns and 10 000 000 cells; at most 1 GB of memory per conversion.
  In practice a 2-column CSV is capped near 1.6 million rows whatever the size limit allows.
- **Time.** A conversion longer than 30 s is stopped → 400 `CONVERSION_TIMEOUT`; the 30 s include
  waiting for a free worker. When every worker and the short queue are busy → 503
  `SERVICE_UNAVAILABLE`.

## Reading each format into one model

Everything is read into a JSON value (objects, arrays, strings, numbers, booleans, null).

| Format | Read as |
| --- | --- |
| CSV (RFC 4180) | An array of objects, one per row, keyed by the header row. Every value is a string. Empty lines are skipped. A row with a different number of fields, an empty or a repeated header name → `FILE_PARSE_ERROR`. |
| JSON (RFC 8259) | As is. |
| XML 1.0 | One object whose single key is the root element. An element's text is a string; attributes become `@name` keys; an element with attributes and text keeps the text under `#text`; repeated sibling elements become an array; the five predefined entities and numeric character references are decoded (a reference to a character XML 1.0 forbids, such as NUL or a surrogate, is refused), **any other entity is refused** (CDATA sections, comments and processing instructions may contain a literal `&`), and **any `<!DOCTYPE` or `<!ENTITY>` is refused** (`FILE_PARSE_ERROR`): no external entities, no entity expansion. Element names that are JavaScript object internals (`constructor`, `prototype`, `__proto__`) are refused (`FILE_PARSE_ERROR`); the parser prefixes `__` to a few others (`toString` → `__toString`). The XML declaration is not data. |
| YAML 1.2 | The core schema: plain data, no custom tags (an unknown tag gives its value as a plain string), no code. Exactly one document (`---` with more → `FILE_PARSE_ERROR`). Duplicate keys are refused. At most 100 aliases, and their expanded size counts against the limits above. Merge keys (`<<`) are not part of YAML 1.2 and stay ordinary keys. `.inf`/`.nan` become `null` in JSON; integers beyond 2^53 lose precision. |

## Writing each format

| Format | Written as |
| --- | --- |
| JSON | Pretty-printed with two spaces, trailing newline. |
| YAML | Block style; repeated objects are written out, never as aliases. |
| XML | `<?xml version="1.0" encoding="UTF-8"?>` and one root: an object with exactly one element key (not an `@attribute`, not `#text`, not an array) is that root; anything else is wrapped in `<root>`; a top-level array becomes `<root><item>…</item>…</root>`; an array value repeats its element; `@name` keys become attributes and `#text` the element's text. A key that is not an XML name (after the `@` for attributes) gets invalid characters replaced by `_` and a leading `_`; names that then collide get `_2`, `_3`, … Characters XML 1.0 cannot carry (control characters, unpaired surrogates, U+FFFE/U+FFFF) become U+FFFD. Any key, `__proto__` included, is kept as data. |
| CSV | A header row and CRLF line endings. A cell (or header) starting with `=`, `+`, `@`, a tab, a carriage return, or `-` not starting a number gets a leading `'`, so a spreadsheet does not run it as a formula ("CSV injection"); the value is changed by that one character. An empty object or array gives an empty file. Rows: single-key wrappers (an XML root, `{"users": [...]}`) are unwrapped until an array or a multi-key object; an array gives one row per element, an object one row. Nested objects become dot-separated columns (`user.name`); arrays inside a row become JSON text; `null` is an empty cell. Columns are the union of all keys in first-seen order; a missing key is an empty cell. A row that is not an object goes into a `value` column. |

## Consequences worth knowing

- CSV values are strings, so CSV → JSON/YAML/XML keeps them as strings (`"36"`, not `36`).
- XML has no types either: XML → JSON/YAML gives strings.
- A round trip through XML or CSV does not return the original structure exactly (attributes,
  arrays of one element, nested objects): these formats cannot express everything JSON can.
