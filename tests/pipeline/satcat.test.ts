import { describe, expect, it } from 'vitest';
import { parseSatcatCsv } from '../../pipeline/satcat';
import { satcatDocument, satcatRow } from './satcatFixture';

const document = satcatDocument;
const row = satcatRow;

describe('parseSatcatCsv', () => {
  it('reads the fields it keeps, exactly as written', () => {
    const parsed = parseSatcatCsv(
      document(
        row('90002', 'R/B', '-', 'PRC', '2019-12-31'),
        row('90001', 'PAY', '+', 'US', '2020-01-07'),
        row('90003', 'DEB', '?', 'CIS', '1999-05-10'),
      ),
    );
    expect(parsed.rowCount).toBe(3);
    expect(parsed.rejected).toEqual({});
    // In catalog-number order, whatever the order in the file.
    expect(parsed.records).toEqual([
      { noradId: 90001, objectType: 'PAY', opsStatus: '+', owner: 'US', launchDate: '2020-01-07' },
      { noradId: 90002, objectType: 'R/B', opsStatus: '-', owner: 'PRC', launchDate: '2019-12-31' },
      { noradId: 90003, objectType: 'DEB', opsStatus: '?', owner: 'CIS', launchDate: '1999-05-10' },
    ]);
  });

  it('accepts empty fields as "nothing published"', () => {
    const parsed = parseSatcatCsv(document(row('90001', '', '', '', '')));
    expect(parsed.records).toEqual([
      { noradId: 90001, objectType: '', opsStatus: '', owner: '', launchDate: '' },
    ]);
  });

  it('keeps codes it has never seen, as long as they have the shape of a code', () => {
    const parsed = parseSatcatCsv(document(row('90001', 'NEW', 'Z', 'XK9', '2020-01-07')));
    expect(parsed.records[0]).toMatchObject({ objectType: 'NEW', opsStatus: 'Z', owner: 'XK9' });
  });

  it('keeps the date and drops the time when a launch date carries one', () => {
    const parsed = parseSatcatCsv(
      document(
        row('90001', 'PAY', '+', 'US', '2020-01-07T02:19:21'),
        row('90002', 'PAY', '+', 'US', '2020-01-07 02:19:21.5Z'),
      ),
    );
    expect(parsed.records.map((record) => record.launchDate)).toEqual(['2020-01-07', '2020-01-07']);
  });

  it('handles quoted names that contain commas', () => {
    const parsed = parseSatcatCsv(
      document(row('90001', 'PAY', '+', 'US', '2020-01-07', '"NAME, WITH COMMA"')),
    );
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.owner).toBe('US');
  });

  it('leaves out rows that fail a check, and counts them by reason', () => {
    const parsed = parseSatcatCsv(
      document(
        row('', 'PAY', '+', 'US', '2020-01-07'), // no catalog number
        row('12a', 'PAY', '+', 'US', '2020-01-07'), // not a number
        row('0', 'PAY', '+', 'US', '2020-01-07'), // not a valid catalog number
        row('90001', 'payload', '+', 'US', '2020-01-07'), // not the shape of a type code
        row('90002', 'PAY', 'OPERATIONAL', 'US', '2020-01-07'), // far too long for a status code
        row('90003', 'PAY', '+', 'United States', '2020-01-07'), // not the shape of an owner code
        row('90004', 'PAY', '+', 'US', '2020-02-30'), // not a real date
        row('90005', 'PAY', '+', 'US', '7 Jan 2020'), // not in the documented form
        row('90006', 'PAY', '+', 'US', '2020-01-07'),
        row('90006', 'DEB', '-', 'US', '2020-01-07'), // duplicate; the first is kept
      ),
    );
    expect(parsed.rowCount).toBe(10);
    expect(parsed.rejected).toEqual({
      'missing-field': 1,
      'not-a-number': 2,
      'bad-code': 3,
      'bad-date': 2,
      duplicate: 1,
    });
    expect(parsed.records).toEqual([
      { noradId: 90006, objectType: 'PAY', opsStatus: '+', owner: 'US', launchDate: '2020-01-07' },
    ]);
  });

  it('refuses a document that is not SATCAT CSV', () => {
    expect(() => parseSatcatCsv('')).toThrow('The document is empty');
    expect(() => parseSatcatCsv('<html><body>Not found</body></html>')).toThrow(
      /does not have the expected SATCAT columns\. Missing: NORAD_CAT_ID, OBJECT_TYPE/,
    );
    // Orbital-elements CSV has a catalog number but none of the descriptive fields.
    expect(() => parseSatcatCsv('OBJECT_NAME,NORAD_CAT_ID,EPOCH\r\nX,1,2020\r\n')).toThrow(
      /Missing: OBJECT_TYPE, OPS_STATUS_CODE, OWNER, LAUNCH_DATE/,
    );
  });

  it('reads a document with a header and no rows as empty', () => {
    expect(parseSatcatCsv(document())).toEqual({ rowCount: 0, records: [], rejected: {} });
  });
});
