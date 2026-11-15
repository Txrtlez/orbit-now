import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../pipeline/csv';

describe('parseCsv', () => {
  it('splits rows and fields, with LF or CRLF line endings', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads the last row even without a final line break', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty fields, including a trailing one', () => {
    expect(parseCsv('a,,c\n,,\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('handles quoted fields containing commas, quotes and line breaks', () => {
    expect(parseCsv('name,id\n"SAT, THE FIRST",1\n"SAY ""HI""",2\n"TWO\nLINES",3\n')).toEqual([
      ['name', 'id'],
      ['SAT, THE FIRST', '1'],
      ['SAY "HI"', '2'],
      ['TWO\nLINES', '3'],
    ]);
  });

  it('distinguishes a quoted empty field from a blank line', () => {
    expect(parseCsv('a\n""\n\nb\n')).toEqual([['a'], [''], ['b']]);
  });

  it('ignores a byte-order mark and skips blank lines', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns no rows for an empty document', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });

  it('refuses malformed quoting instead of guessing', () => {
    expect(() => parseCsv('a,b\n1,"unterminated\n')).toThrow(/ends inside a quoted field/);
    expect(() => parseCsv('a\nab"c\n')).toThrow(/unexpected quote/);
    expect(() => parseCsv('a\n"ab"c\n')).toThrow(/after a closing quote/);
  });
});
