# Where the growth-of-orbit numbers come from

The chart "Growth of orbit" shows how many catalogued objects were in Earth orbit each month from
January 1957 to May 2026, in total and by kind. This file records where those numbers came from and
how far they can be trusted. The checks made on them are in `VALIDATION.md`, entry V5.1.

## The source

NASA Orbital Debris Program Office, _Orbital Debris Quarterly News_, volume 30, issues 1 & 2, July 2026, page 9: the chart "Monthly Number of Cataloged Objects in Earth Orbit by Object Type as of
3 May 2026".

<https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv30i1.pdf> (2,083,558 bytes when read on
2026-11-15)

Its caption says that it summarises all objects in Earth orbit officially catalogued by the US Space
Surveillance Network, that "fragmentation debris" includes satellite breakup debris and anomalous
event debris, and that "mission-related debris" includes all objects dispensed, separated or
released as part of the planned mission. The chart has five lines: Total Objects, Spacecraft,
Fragmentation Debris, Rocket Bodies and Mission-related Debris.

The NASA Technical Reports Server's record for an earlier issue of the newsletter (April 2024,
document 20240004032) gives its copyright status as "Work of the US Gov. Public Use Permitted". The
record for this issue was not looked up.

## Why the numbers had to be read from a picture

NASA publishes the chart, not the table behind it. The brief for this project asked for counts from
a citable source (NASA's Orbital Debris Program Office or ESA's annual Space Environment Report).
ESA's report (issue 10.0, 1 May 2026) shows the history in its Figure 2.1 and says that the data
behind its analysis is available from its DISCOS database; no table of yearly counts was found in
the part of the report that was read, which was about the first half. To my knowledge DISCOS needs
an account, which was not checked, and a source that needs an account is the owner's decision. This
site's own catalog cannot supply a history either: it is not the full public catalog and holds no
objects that have decayed.

## How they were read

In the PDF the chart is not an image. It is a vector drawing, and each of its five lines is one
path of 833 vertices, one per month. The vertices were taken from the page's drawing instructions,
so nothing was measured off a picture by eye.

1. The PDF was fetched in a browser from NASA's site and the page's content stream was
   decompressed. The chart is in the stream of 85,131 characters that draws page 9.
2. The five paths with 833 vertices were identified by the stroke colour and dash pattern set just
   before each, matched to the chart's own legend, which sets the same colour and dash before each
   name: dark red solid for Total Objects, blue solid for Spacecraft, magenta dotted for
   Fragmentation Debris, green dash-dot for Rocket Bodies, orange dashed for Mission-related Debris.
3. The chart is printed turned on its side, so a line's distance from the zero line runs along the
   page's x axis. The axis was calibrated from the chart's own tick marks: eight major ticks,
   labelled 0 to 35,000 in steps of 5,000, spanning 374.288 PDF points. One object is therefore
   0.010694 points.
4. Along the time axis the tick marks are labelled 1956 to 2026. The first vertex of each line is
   one year after the axis's start and the last is 120 days after the tick for 2026, and the
   vertices are evenly spaced by month in between: January 1957 to May 2026, which is 833 months,
   in agreement with the caption's "as of 3 May 2026".
5. The 4,165 values were copied out of the browser as text. A checksum was computed in the browser
   before copying and again in this repository afterwards, and the two agree for all five lines.
   `series.test.ts` repeats that comparison on every test run.

`odqnFigure.ts` holds the vertices exactly as read, in thousandths of a PDF point from the zero
line. `series.ts` converts them to objects.

## How good they are

- **Resolution.** The lines were drawn on a grid of 0.153125 points, which is 14.3 objects. A count
  recovered from a vertex is therefore within about 7 objects of the value NASA plotted, if the
  drawing program rounded to the nearest grid point. That rounding rule is inferred from the data
  (see the next point), not read in any documentation.
- **Internal check.** For the 743 months to November 2018 the total differs from the sum of the
  four kinds by 37 objects at most and 8.4 on average. Five independent readings, each good to about
  7 objects, would give exactly that.
- **Early years.** Until about 1960 the counts themselves are no larger than a few grid steps, so
  the reading says little about them. The site does not print a number below 20.
- **From December 2018 the total exceeds the sum of the four kinds**, by 65 objects in January 2019
  rising to 680 in May 2026. The chart does not say what makes up the difference. The site shows
  the total and the four kinds as NASA drew them and says that they differ.
- **The last point** is 3 May 2026, three days into its month, and is lower than April's.
- **A break-up's debris appears in the month of the break-up.** The fragmentation line steps up by
  about 3,480 in January 2007, although NASA had catalogued only 2,087 pieces of Fengyun-1C by the
  end of that September (Orbital Debris Quarterly News 11-4, October 2007). So the chart is not a
  record of how large the catalog was at the time; it places each catalogued object at the date it
  came into being.

## What was not done

Nobody compared the recovered values with the chart by eye, point by point. No second source of
monthly counts was available to compare against. The comparisons that were possible, with numbers
NASA printed elsewhere, are in `VALIDATION.md`, V5.1.
