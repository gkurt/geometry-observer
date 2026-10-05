import { isSupported } from '#src/index.ts';
import { GROUP_STYLE, PROBE_STYLE } from '#src/probe.ts';

/**
 * Whether a probe in this engine notices its anchor being hidden by a CSS change
 * alone, with no DOM mutation behind it: a stylesheet edit, or a pseudo-class.
 *
 * It only matters for a 0×0 target. A target with a size shrinks to 0×0 when
 * hidden, which its own `ResizeObserver` sees in every engine. WebKit 26 and 27
 * don't restyle the probe when its anchor goes away (see `src/support.ts`), and the
 * observer's mutation watch can't see a CSS-only change. Measured rather than
 * assumed, so the test starts running on an engine once it works. The sampling
 * fallback always sees it.
 */
async function probeSeesCssOnlyLoss(): Promise<boolean> {
  const sheet = document.createElement('style');
  document.head.append(sheet);
  const host = document.createElement('div');
  host.innerHTML = '<div class="cap-target" style="anchor-name:--cap-probe;width:40px;height:12px"></div>';
  document.body.append(host);

  const group = document.createElement('div');
  group.setAttribute('popover', 'manual');
  for (const [property, value] of Object.entries(GROUP_STYLE)) group.style.setProperty(property, value, 'important');
  const probe = document.createElement('div');
  for (const [property, value] of Object.entries({ ...PROBE_STYLE, 'position-anchor': '--cap-probe' }))
    probe.style.setProperty(property, value, 'important');
  group.append(probe);
  document.body.append(group);
  try {
    group.showPopover();
  } catch {
    // No top layer. The measurement below still gives the answer.
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  const before = probe.getBoundingClientRect().left;
  sheet.sheet?.insertRule('.cap-target { display: none }');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = probe.getBoundingClientRect().left;

  group.remove();
  host.remove();
  sheet.remove();
  return after !== before;
}

export const SEES_CSS_ONLY_LOSS = !isSupported() || (await probeSeesCssOnlyLoss());

/**
 * Whether this engine resolves `anchor()` against a target's transformed box. Firefox
 * 155 resolves it against the untransformed box, so a change to an ancestor's
 * `transform` doesn't resize the probe. The sampling fallback always sees it.
 */
function anchorFollowsTransforms(): boolean {
  const host = document.createElement('div');
  host.innerHTML = '<div style="anchor-name:--cap-transform;width:40px;height:12px"></div>';
  document.body.append(host);
  const group = document.createElement('div');
  group.setAttribute('popover', 'manual');
  for (const [property, value] of Object.entries(GROUP_STYLE)) group.style.setProperty(property, value, 'important');
  const probe = document.createElement('div');
  for (const [property, value] of Object.entries({ ...PROBE_STYLE, 'position-anchor': '--cap-transform' }))
    probe.style.setProperty(property, value, 'important');
  group.append(probe);
  document.body.append(group);
  try {
    group.showPopover();
  } catch {
    // No top layer. The measurement below still gives the answer.
  }

  const before = probe.getBoundingClientRect().left;
  host.style.transform = 'translateX(30px)';
  const after = probe.getBoundingClientRect().left;
  group.remove();
  host.remove();
  return after !== before;
}

export const FOLLOWS_TRANSFORMS = !isSupported() || anchorFollowsTransforms();
