/**
 * "About the data and models": what is real, what is a standard model,
 * what is simplified, how far each can be trusted, and who to thank.
 *
 * Loaded when the page is first opened, not with the site. Every figure
 * here is taken from VALIDATION.md or the README, which say how it was
 * measured; if one changes there, change it here.
 */

export interface AboutFacts {
  /** Objects in the catalog this visit loaded, or null if it did not load. */
  readonly objectCount: number | null;
  /** When that catalog was put together (ISO 8601), or null. */
  readonly generatedAt: string | null;
}

const REPOSITORY = 'https://github.com/Txrtlez/orbit-now';

type Part = string | { readonly text: string; readonly href: string };

function paragraph(parts: readonly Part[], className = ''): HTMLParagraphElement {
  const node = document.createElement('p');
  if (className !== '') {
    node.className = className;
  }
  for (const part of parts) {
    if (typeof part === 'string') {
      node.append(part);
    } else {
      const link = document.createElement('a');
      link.href = part.href;
      link.textContent = part.text;
      link.rel = 'noopener';
      node.append(link);
    }
  }
  return node;
}

function list(items: readonly (string | readonly Part[])[]): HTMLUListElement {
  const node = document.createElement('ul');
  node.className = 'about-list';
  for (const item of items) {
    const entry = document.createElement('li');
    entry.append(...paragraph(typeof item === 'string' ? [item] : item).childNodes);
    node.append(entry);
  }
  return node;
}

function section(
  id: string,
  title: string,
  tag: string | null,
  ...content: readonly HTMLElement[]
): HTMLElement {
  const node = document.createElement('section');
  node.className = 'about-section';
  node.id = `about-${id}`;
  const heading = document.createElement('h3');
  heading.textContent = title;
  if (tag !== null) {
    const label = document.createElement('span');
    label.className = 'tag';
    label.textContent = tag;
    heading.append(' ', label);
  }
  node.append(heading, ...content);
  return node;
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  const scroll = document.createElement('div');
  scroll.className = 'growth-table-scroll';
  // On a narrow screen the table scrolls sideways; a keyboard has to be able to reach it to do so.
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Table: the model against three real break-ups');
  const node = document.createElement('table');
  node.className = 'growth-table about-table';
  const top = document.createElement('thead');
  const topRow = document.createElement('tr');
  for (const title of head) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = title;
    topRow.append(cell);
  }
  top.append(topRow);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const line = document.createElement('tr');
    row.forEach((text, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) {
        cell.setAttribute('scope', 'row');
      }
      cell.textContent = text;
      line.append(cell);
    });
    body.append(line);
  }
  node.append(top, body);
  scroll.append(node);
  return scroll;
}

function describeDate(iso: string | null): string {
  const time = iso === null ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(time)) {
    return 'not known';
  }
  return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function mountAbout(container: HTMLElement, facts: AboutFacts): void {
  const count =
    facts.objectCount === null
      ? 'The orbital data did not load on this visit.'
      : `This visit loaded ${new Intl.NumberFormat('en-GB').format(facts.objectCount)} objects, from data put together on ${describeDate(facts.generatedAt)}.`;

  container.replaceChildren(
    paragraph(
      [
        'Orbit Now shows where satellites and debris are at this moment, and lets you stage a break-up to see what a standard model makes of it. This page says where each part comes from and how far it can be trusted. Three labels are used throughout the site:',
      ],
      'about-lead',
    ),
    list([
      'Real data: measured or defined values taken from a named source.',
      'Standard model: an established physical or mathematical model, used as published.',
      'Simplification: something this site approximates, with the approximation stated.',
    ]),

    section(
      'data',
      'The data',
      'Real data',
      list([
        [
          'Orbits: ',
          { text: 'CelesTrak', href: 'https://celestrak.org' },
          ' (Dr T.S. Kelso), which republishes the element sets issued by the US Space Force’s 18th Space Defense Squadron. Five of its lists are used: active satellites, the debris of Fengyun-1C, of Cosmos 2251 and of Iridium 33, and its hundred or so brightest objects.',
        ],
        'Update schedule: a scheduled job asks CelesTrak three times a day, at about 03:17, 11:17 and 19:17 UTC, and the site loads whatever it last published. Scheduled jobs can start late. ' +
          count,
        'What is missing: this is not every tracked object. Dead satellites, spent rocket stages and most debris are not in the lists used. NASA counted about 33,500 catalogued objects in orbit in May 2026; this site draws roughly 19,700. Debris from Cosmos 1408 is not drawn at all, because CelesTrak has no list for it.',
        'What each object is (kind, owner, launch date, status): CelesTrak’s satellite catalog, asked for once a day. Constellation names are worked out from the object’s name, which is a guess.',
        'Growth of orbit since 1957: NASA Orbital Debris Program Office, Orbital Debris Quarterly News, volume 30, issues 1 and 2 (July 2026), page 9. No table is published, so the numbers were read from the lines of the figure and are good to roughly ten objects.',
        'The three break-ups: NASA’s History of On-orbit Satellite Fragmentations, 16th edition, and Orbital Debris Quarterly News issues 11-2, 12-1, 13-2, 27-1 and 28-2.',
        'Earth imagery: NASA Earth Observatory, Blue Marble Next Generation (2004) and Black Marble (2012).',
        [
          'City names and positions: ',
          { text: 'GeoNames', href: 'https://www.geonames.org' },
          ' (CC BY 4.0), places of 15,000 people or more.',
        ],
      ]),
    ),

    section(
      'models',
      'The models',
      'Standard model',
      list([
        'Where each object is: the SGP4 model, the one the element sets are made for, through the satellite.js library. It was checked against the published verification set of Vallado, Crawford, Hujsak and Kelso (2006): 666 positions agree to 0.12 mm or better. One deliberately impossible test orbit is handled differently, and that is recorded.',
        'Passes over your place: the same positions turned into directions in your sky. A pass is listed as visible when the satellite is in sunlight while your sky is dark. Space Station passes were compared with Heavens-Above for four cities: the times agree within 5 seconds over ten days.',
        'Break-ups in “What if?”: the NASA Standard Breakup Model (Johnson and others, 2001; mass handling as described by Krisko, 2011) for how many fragments there are and their sizes, weights and speeds. Its size curves were checked against NASA’s published ones.',
        'Fragment orbits in “What if?”: the standard formulas for how the Earth’s bulge turns an orbit and how air drag shrinks it, averaged over a revolution. They agree with step-by-step calculation to 0.2% for the turning and 3.4% or better for the shrinking.',
      ]),
    ),

    section(
      'simplifications',
      'Simplifications and limits',
      'Simplification',
      list([
        'An element set is a forecast made when it was issued, and it goes stale. The object’s card shows how old its set is. Running the clock days ahead shows where the forecast puts things, not where they will be.',
        'Positions are worked out every few seconds and joined smoothly in between. The difference is far smaller than a dot.',
        'The line between day and night follows the Sun’s real position; the twilight band along it is a simple blend.',
        'For passes, the Earth’s shadow is a plain cylinder and you are assumed to be at sea level. “Visible” says nothing about brightness, cloud or buildings. No predicted pass has yet been checked against the sky itself.',
        'Passes are computed from today’s elements, so those several days ahead are less certain.',
        'In “What if?”, the air is one fixed table of density against height, with no solar cycle; the Sun setting only makes it three times thinner or thicker. Sunlight pressure and the pull of the Sun and Moon are left out. Only pieces of 10 cm and more are made.',
      ]),
    ),

    section(
      'disagreements',
      'Where “What if?” disagrees with what really happened',
      'Illustrative model',
      paragraph([
        'Three of the events on offer are set up like real ones, so the model can be compared with history. It gets how long debris lasts about right, and how many pieces a particular event makes wrong by a factor of up to four.',
      ]),
      table(
        [
          'Set up like',
          'Pieces, model',
          'Pieces catalogued',
          'Still in orbit, model',
          'Still in orbit, really',
        ],
        [
          ['Fengyun-1C, 2007', '863', '3,532', '76% after 16 years', '79%'],
          ['Iridium 33 and Cosmos 2251, 2009', '1,194', '2,372', '64% after 14 years', '56%'],
          ['Cosmos 1408, 2021', '1,364', '1,785', '25% after 14 months', '20%'],
        ],
      ),
      list([
        'The model gives the average for a break-up of a given mass; real events differ. NASA found that Fengyun-1C made more pieces, and lighter ones, than the model gives, and that Iridium 33’s pieces were lighter for their size than the model’s.',
        'For Fengyun-1C, NASA wrote that its model predicts about 1,000 pieces in orbit after the first day. This site’s version gives 788. The cause of that difference has not been found.',
        'The closeness of the “still in orbit” figures is partly luck: the real decay depended on the Sun’s cycle, which the model does not have.',
        'The count of hits on other satellites is not a forecast of collisions. The targets are the satellites in this site’s data, nearly all of them working and able to move aside; dead satellites and spent rocket stages, which cannot, are mostly missing; each target is assumed to weigh 500 kg; and the debris of any later collision is not followed. So the site does not simulate a chain of collisions. For comparison only: a NASA study (Liou and Johnson, Science, 2006) that did follow the whole tracked population found about 18 collisions in 200 years even with no further launches.',
        'One detail of the breakup model, how the ratio of area to mass is spread among large fragments, was written from memory of the model and not checked against the original 2001 paper.',
      ]),
    ),

    section(
      'privacy',
      'Your place and your privacy',
      null,
      list([
        'The place you give for pass predictions is kept in your browser and is not sent anywhere. City names are looked up in a list the site downloads whole.',
        'The site has no accounts, no advertising and no tracking, and loads everything from its own address.',
        'A link copied from the menu records the view after the “#” in the address. Browsers do not send that part to the server.',
      ]),
    ),

    section(
      'access',
      'Accessibility',
      null,
      list([
        'Everything except picking a dot directly on the globe can be done from the keyboard; to pick an object without a pointer, use the search field.',
        'Movement that happens by itself stops if your device asks for reduced motion, or if you tick “Reduce motion” in the menu.',
        'Colour is never the only way something is told apart: every coloured thing has a label beside it, and the charts have tables.',
        'Known gaps: the tour and the charts have been tested with a keyboard but not with a screen reader by a person who relies on one.',
      ]),
    ),

    section(
      'credits',
      'Credits',
      null,
      list([
        [{ text: 'three.js', href: 'https://threejs.org/' }, ' for 3D drawing (MIT licence).'],
        [
          { text: 'satellite.js', href: 'https://github.com/shashwatak/satellite-js' },
          ' for the SGP4 model (MIT licence).',
        ],
        'CelesTrak and Dr T.S. Kelso for the orbital data and satellite catalog; the US Space Force’s 18th Space Defense Squadron for tracking the objects.',
        'NASA Orbital Debris Program Office for the growth figure, the break-up histories and the breakup model; NASA Earth Observatory for the imagery.',
        'Vallado, Crawford, Hujsak and Kelso, “Revisiting Spacetrack Report #3” (2006), for the SGP4 verification data, obtained through Brandon Rhodes’s sgp4 package.',
        'Heavens-Above for the pass tables the predictions were compared with.',
        'GeoNames for the list of places, through Adam Averay’s cities-15000-structured package.',
        'MIT’s MOCAT-MC for the table of air density it reproduces from Vallado’s textbook.',
      ]),
    ),

    section(
      'record',
      'The full record',
      null,
      paragraph([
        'Every check behind this page, with its numbers, dates and how to repeat it, is in ',
        { text: 'VALIDATION.md', href: `${REPOSITORY}/blob/main/VALIDATION.md` },
        '. The design decisions and the list of known issues are in the ',
        { text: 'README', href: `${REPOSITORY}#readme` },
        '.',
      ]),
    ),
  );
}
