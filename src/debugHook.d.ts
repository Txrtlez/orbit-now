/**
 * A small hook the page publishes once objects are on the globe, for the
 * end-to-end tests, which need to know where an object is on screen in
 * order to click it. It is absent until then. This file is shared by the
 * application and the tests so that both agree on its shape.
 */
interface OrbitNowDebug {
  /** Catalog numbers of every object, in catalog order. */
  noradIds(): number[];
  /** Where an object appears in the view, in CSS pixels, or null if it cannot currently be seen. */
  screenPositionOf(noradId: number): { x: number; y: number } | null;
}

interface Window {
  orbitNowDebug?: OrbitNowDebug;
}
