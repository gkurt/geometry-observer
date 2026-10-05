import { isSupported } from '#src/index.ts';

/**
 * Whether this engine reports a target being hidden or detached.
 *
 * Losing an anchor only raises an event because `anchor()` is given a length
 * fallback — without one the property goes invalid at computed-value time and
 * resolves to `auto`, and a length does not interpolate to `auto`. Chromium
 * applies that fallback. WebKit 26 applies it only when the probe is a direct
 * child of `<body>`; any element parent silences it, regardless of wrapper depth,
 * tree position, or whether the probe is in the top layer. The spec ties anchor
 * resolution to containing blocks, not parents, and a `position: fixed` probe's
 * containing block is always the viewport — so this is a WebKit bug, not a rule we
 * can design around. Measured here rather than sniffed, so the suite lights up on
 * its own if it is fixed.
 *
 * Irrelevant where anchor positioning does not resolve: the sampling fallback
 * sees every state change by construction.
 */
async function anchorReportsTeardown(): Promise<boolean> {
  const host = document.createElement('div');
  host.innerHTML = '<div style="anchor-name:--cap-probe;width:40px;height:12px"></div>';
  document.body.append(host);
  const target = host.querySelector<HTMLElement>('div')!;

  // Mirror the library exactly, group included — the group is what WebKit trips on.
  const group = document.createElement('div');
  group.style.setProperty('display', 'contents', 'important');
  document.body.append(group);

  const probe = document.createElement('div');
  probe.setAttribute('popover', 'manual');
  const declarations: Record<string, string> = {
    position: 'fixed',
    visibility: 'hidden',
    'pointer-events': 'none',
    'position-anchor': '--cap-probe',
    top: 'anchor(top, -99999px)',
    width: 'anchor-size(width, 0px)',
    transition: 'top 1ms 0ms, width 1ms 0ms',
  };
  for (const [property, value] of Object.entries(declarations)) probe.style.setProperty(property, value, 'important');
  group.append(probe);
  try {
    probe.showPopover();
  } catch {
    // No top layer; the measurement below still answers the question.
  }

  let fired = 0;
  probe.addEventListener('transitionstart', () => fired++);
  await new Promise((resolve) => setTimeout(resolve, 200));
  target.style.display = 'none';
  await new Promise((resolve) => setTimeout(resolve, 200));

  group.remove();
  host.remove();
  return fired > 0;
}

export const REPORTS_TEARDOWN = !isSupported() || (await anchorReportsTeardown());
