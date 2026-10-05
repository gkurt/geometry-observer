---
packages:
  'geometry-observer': minor
---

### First release, as an experiment

`GeometryObserver`, `observeGeometry()` and the `geometry-observer/react` hook report when an element moves or resizes for any reason, with no work while the page is idle. Once layout changes, it costs more than a rAF loop or Floating UI; see the README's Performance section.
