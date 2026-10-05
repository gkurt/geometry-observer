---
packages:
  'geometry-observer': minor
---

### Reports layout changes in the same frame, through ResizeObserver probes

Probes now encode the target's position in their size and report through a `ResizeObserver` instead of a transition. Under constant motion this is about 3× cheaper in Chromium, reports arrive in the frame of the change, and Firefox runs natively instead of checking every frame. `track: 'size'` needs no probe at all. `settle` is now a timer, and `batch` only affects scrolls, viewport resizes and toggles.
