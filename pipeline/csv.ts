/**
 * Minimal CSV reader following RFC 4180: comma-separated fields, optional
 * double quotes around a field, a doubled quote ("") for a literal quote
 * inside a quoted field, and LF or CRLF line endings.
 *
 * Written here instead of pulling in a library because the need is small and
 * the behaviour on malformed input must be strict: a file that is not
 * well-formed is refused, never "repaired".
 */

/** Parse CSV text into rows of fields. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  // A byte-order mark at the start of the file is not part of the data.
  const input = text.startsWith('﻿') ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = (): void => {
    // A line with no fields at all, as opposed to one empty quoted field (""),
    // is a blank line and is skipped. This has to be decided before endField()
    // clears the record of whether the field was quoted.
    const isBlankLine = row.length === 0 && field === '' && !fieldWasQuoted;
    endField();
    if (!isBlankLine) {
      rows.push(row);
    }
    row = [];
  };

  while (i < input.length) {
    const char = input.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
      continue;
    }

    if (char === '"') {
      if (field !== '' || fieldWasQuoted) {
        throw new Error(`Malformed CSV: unexpected quote in row ${String(rows.length + 1)}`);
      }
      inQuotes = true;
      fieldWasQuoted = true;
      i += 1;
    } else if (char === ',') {
      endField();
      i += 1;
    } else if (char === '\n') {
      endRow();
      i += 1;
    } else if (char === '\r' && input.charAt(i + 1) === '\n') {
      endRow();
      i += 2;
    } else {
      if (fieldWasQuoted) {
        throw new Error(
          `Malformed CSV: text after a closing quote in row ${String(rows.length + 1)}`,
        );
      }
      field += char;
      i += 1;
    }
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: the file ends inside a quoted field');
  }
  // Final row, if the file does not end with a line break.
  if (field !== '' || fieldWasQuoted || row.length > 0) {
    endRow();
  }
  return rows;
}
