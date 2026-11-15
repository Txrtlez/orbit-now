/**
 * What the codes in the satellite catalog (SATCAT) mean.
 *
 * REAL DATA, transcribed from CelesTrak's own pages on 2026-11-15:
 * object types from https://celestrak.org/satcat/satcat-format.php,
 * operational statuses from https://celestrak.org/satcat/status.php (last
 * updated 2026 Oct 12), and owners from
 * https://celestrak.org/satcat/sources.php (last updated 2026 Jan 09).
 *
 * The pages were read through an automated page reader, not copied by
 * hand, and the owner list in particular has not been checked row by row
 * against the original (VALIDATION.md, V3.10). Spellings are CelesTrak's.
 * A code that is not in these tables is shown as the bare code; nothing is
 * guessed.
 */

/** Object types. */
export const OBJECT_TYPE_LABELS: Readonly<Record<string, string>> = {
  PAY: 'Payload',
  'R/B': 'Rocket body',
  DEB: 'Debris',
  UNK: 'Unknown',
};

/** The object types in the order they are offered as filters. */
export const OBJECT_TYPE_ORDER: readonly string[] = ['PAY', 'R/B', 'DEB', 'UNK'];

/** Operational statuses. CelesTrak counts +, P, B, S and X as "active". */
export const OPS_STATUS_LABELS: Readonly<Record<string, string>> = {
  '+': 'Operational',
  '-': 'Nonoperational',
  P: 'Partially operational',
  B: 'Backup or standby',
  S: 'Spare',
  X: 'Extended mission',
  D: 'Decayed',
  '?': 'Unknown',
};

/** Owners: countries and organisations. */
export const OWNER_NAMES: Readonly<Record<string, string>> = {
  AB: 'Arab Satellite Communications Organization',
  ABS: 'Asia Broadcast Satellite',
  AC: 'Asia Satellite Telecommunications Company (ASIASAT)',
  ALG: 'Algeria',
  ANG: 'Angola',
  ARGN: 'Argentina',
  ARM: 'Republic of Armenia',
  ASRA: 'Austria',
  AUS: 'Australia',
  AZER: 'Azerbaijan',
  BEL: 'Belgium',
  BELA: 'Belarus',
  BERM: 'Bermuda',
  BGD: 'Peoples Republic of Bangladesh',
  BHR: 'The Kingdom of Bahrain',
  BHUT: 'The Kingdom of Bhutan',
  BOL: 'Bolivia',
  BRAZ: 'Brazil',
  BUL: 'Bulgaria',
  BWA: 'Republic of Botswana',
  CA: 'Canada',
  CHBZ: 'China/Brazil',
  CHTU: 'China/Türkiye',
  CHLE: 'Chile',
  CIS: 'Commonwealth of Independent States (former USSR)',
  COL: 'Colombia',
  CRI: 'Republic of Costa Rica',
  CZCH: 'Czech Republic (former Czechoslovakia)',
  DEN: 'Denmark',
  DJI: 'Republic of Djibouti',
  ECU: 'Ecuador',
  EGYP: 'Egypt',
  ESA: 'European Space Agency',
  ESRO: 'European Space Research Organization',
  EST: 'Estonia',
  ETH: 'Ethiopia',
  EUME: 'European Organization for the Exploitation of Meteorological Satellites (EUMETSAT)',
  EUTE: 'European Telecommunications Satellite Organization (EUTELSAT)',
  FGER: 'France/Germany',
  FIN: 'Finland',
  FR: 'France',
  FRIT: 'France/Italy',
  GER: 'Germany',
  GHA: 'Republic of Ghana',
  GLOB: 'Globalstar',
  GREC: 'Greece',
  GRSA: 'Greece/Saudi Arabia',
  GUAT: 'Guatemala',
  HRV: 'Republic of Croatia',
  HUN: 'Hungary',
  IM: 'International Mobile Satellite Organization (INMARSAT)',
  IND: 'India',
  INDO: 'Indonesia',
  IRAN: 'Iran',
  IRAQ: 'Iraq',
  IRID: 'Iridium',
  IRL: 'Ireland',
  ISRA: 'Israel',
  ISRO: 'Indian Space Research Organisation',
  ISS: 'International Space Station',
  IT: 'Italy',
  ITSO: 'International Telecommunications Satellite Organization (INTELSAT)',
  JPN: 'Japan',
  KAZ: 'Kazakhstan',
  KEN: 'Republic of Kenya',
  LAOS: 'Laos',
  LKA: 'Democratic Socialist Republic of Sri Lanka',
  LTU: 'Lithuania',
  LUXE: 'Luxembourg',
  MA: 'Morroco',
  MALA: 'Malaysia',
  MCO: 'Principality of Monaco',
  MDA: 'Republic of Moldova',
  MEX: 'Mexico',
  MMR: 'Republic of the Union of Myanmar',
  MNE: 'Montenegro',
  MNG: 'Mongolia',
  MUS: 'Mauritius',
  NATO: 'North Atlantic Treaty Organization',
  NETH: 'Netherlands',
  NICO: 'New ICO',
  NIG: 'Nigeria',
  NKOR: "Democratic People's Republic of Korea",
  NOR: 'Norway',
  NPL: 'Federal Democratic Republic of Nepal',
  NZ: 'New Zealand',
  O3B: 'O3b Networks',
  ORB: 'ORBCOMM',
  PAKI: 'Pakistan',
  PERU: 'Peru',
  POL: 'Poland',
  POR: 'Portugal',
  PRC: "People's Republic of China",
  PRY: 'Republic of Paraguay',
  PRES: "People's Republic of China/European Space Agency",
  QAT: 'State of Qatar',
  RASC: 'RascomStar-QAF',
  ROC: 'Taiwan (Republic of China)',
  ROM: 'Romania',
  RP: 'Philippines (Republic of the Philippines)',
  RWA: 'Republic of Rwanda',
  SAFR: 'South Africa',
  SAUD: 'Saudi Arabia',
  SDN: 'Republic of Sudan',
  SEAL: 'Sea Launch',
  SEN: 'Republic of Senegal',
  SES: 'SES',
  SGJP: 'Singapore/Japan',
  SING: 'Singapore',
  SKOR: 'Republic of Korea',
  SLB: 'Solomon Islands',
  SPN: 'Spain',
  STCT: 'Singapore/Taiwan',
  SVN: 'Slovenia',
  SWED: 'Sweden',
  SWTZ: 'Switzerland',
  TBD: 'To Be Determined',
  THAI: 'Thailand',
  TMMC: 'Turkmenistan/Monaco',
  TUN: 'Republic of Tunisia',
  TURK: 'Türkiye',
  UAE: 'United Arab Emirates',
  UK: 'United Kingdom',
  UKR: 'Ukraine',
  UNK: 'Unknown',
  URY: 'Uruguay',
  US: 'United States',
  USBZ: 'United States/Brazil',
  VAT: 'Vatican City State',
  VENZ: 'Venezuela',
  VTNM: 'Vietnam',
  ZWE: 'Republic of Zimbabwe',
};

/** An object type in words, or the bare code if it is not a known one. */
export function describeObjectType(code: string): string {
  return OBJECT_TYPE_LABELS[code] ?? code;
}

/** An operational status in words, or the bare code if it is not a known one. */
export function describeOpsStatus(code: string): string {
  return OPS_STATUS_LABELS[code] ?? code;
}

/** An owner's name followed by its code, "United States (US)", or the bare code if it is not a known one. */
export function describeOwner(code: string): string {
  const name = OWNER_NAMES[code];
  return name === undefined ? code : `${name} (${code})`;
}
