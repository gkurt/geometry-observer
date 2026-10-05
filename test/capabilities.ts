import { isSupported } from '#src/index.ts';
import { GROUP_STYLE, PROBE_STYLE } from '#src/probe.ts';

/**
 * Whether this engine reports a target hidden by a CSS change alone, with no DOM
 * mutation behind it: a stylesheet edit, or a pseudo-class like `:hover`.
 *
 * That depends on the engine restyling the probe when its anchor goes away, which
 * WebKit 26 and 27 don't do (see `src/support.ts`). The observer covers DOM
 * mutations there, but a CSS-only change raises nothing it can see. Measured rather
 * than assumed, so the test starts running on an engine once it works. The
 * sampling fallback always sees it.
 */
async function anchorReportsCssOnlyTeardown(): Promise<boolean> {
  const sheet = document.createElement('style');
  document.head.append(sheet);
  const host = document.createElement('div');
  host.innerHTML = '<div class="cap-target" style="anchor-name:--cap-probe;width:40px;height:12px"></div>';
  document.body.append(host);

  const group = document.createElement('div');
  group.setAttribute('popover', 'manual');
  for (const [property, value] of Object.entries(GROUP_STYLE)) group.style.setProperty(property, value, 'important');
  const probe = document.createElement('div');
  const declarations = { ...PROBE_STYLE, 'position-anchor': '--cap-probe', transition: 'top 1ms, width 1ms' };
  for (const [property, value] of Object.entries(declarations)) probe.style.setProperty(property, value, 'important');
  group.append(probe);
  document.body.append(group);
  try {
    group.showPopover();
  } catch {
    // No top layer. The measurement below still gives the answer.
  }

  let fired = 0;
  probe.addEventListener('transitionstart', () => fired++);
  await new Promise((resolve) => setTimeout(resolve, 200));
  sheet.sheet?.insertRule('.cap-target { display: none }');
  await new Promise((resolve) => setTimeout(resolve, 200));

  group.remove();
  host.remove();
  sheet.remove();
  return fired > 0;
}

export const REPORTS_CSS_ONLY_TEARDOWN = !isSupported() || (await anchorReportsCssOnlyTeardown());
