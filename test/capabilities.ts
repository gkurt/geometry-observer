import { isSupported } from '#src/index.ts';

/**
 * Whether this engine reports a target being hidden or detached.
 *
 * That depends on the probe's `anchor()` length fallback, which WebKit 26 ignores
 * whenever the probe has an element parent (see `src/probe.ts`). Measured rather
 * than assumed, so the teardown tests start running on an engine once it works.
 * The sampling fallback always sees teardown.
 */
async function anchorReportsTeardown(): Promise<boolean> {
  const host = document.createElement('div');
  host.innerHTML = '<div style="anchor-name:--cap-probe;width:40px;height:12px"></div>';
  document.body.append(host);
  const target = host.querySelector<HTMLElement>('div')!;

  // Mirror the library, wrapper included: the wrapper is what WebKit trips on.
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
    // No top layer. The measurement below still gives the answer.
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
