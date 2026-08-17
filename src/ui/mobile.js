/**
 * Small-screen layout.
 *
 * The desktop HUD is six panels pinned to the corners, which works when there
 * is a corner to spare and a keyboard for the H shortcut. On a phone it covers
 * the thing you came to look at, and there is no key to press.
 *
 * So on small screens the panels are *moved* into a slide-in drawer rather
 * than restyled in place — one DOM move, no duplicated markup, and every
 * control keeps working because it is the same element with the same listeners
 * already attached by Hud. What stays on screen is only what you want while
 * actually watching: the clock, the eclipse banner and the transport bar.
 *
 * The switch is reversible: rotating a tablet back to landscape moves the
 * panels home again.
 */

/** Panels that move into the drawer on a small screen, in drawer order. */
const DRAWER_PANELS = [
  'bodies-panel',
  'info-panel',
  'eclipse-panel',
  'settings-panel',
  'help-panel',
];

const QUERY = '(max-width: 820px), (pointer: coarse) and (max-width: 1180px)';

export class MobileLayout {
  constructor() {
    this.drawer = document.getElementById('drawer');
    this.drawerInner = document.getElementById('drawer-inner');
    this.scrim = document.getElementById('drawer-scrim');
    this.toggle = document.getElementById('drawer-toggle');

    /** Original parent + next sibling, so panels can be put back exactly. */
    this.home = new Map();
    for (const id of DRAWER_PANELS) {
      const el = document.getElementById(id);
      if (el) this.home.set(id, { el, parent: el.parentNode, next: el.nextSibling });
    }

    this.active = false;
    this.open = false;

    this._bind();

    this.media = matchMedia(QUERY);
    this.media.addEventListener('change', () => this.apply());
    this.apply();
  }

  _bind() {
    this.toggle.addEventListener('click', () => this.setOpen(!this.open));
    document.getElementById('drawer-close').addEventListener('click', () => this.setOpen(false));
    this.scrim.addEventListener('click', () => this.setOpen(false));

    document.getElementById('ui-toggle').addEventListener('click', () => {
      this.setOpen(false);
      document.body.classList.toggle('ui-hidden');
    });

    // Tapping the canvas while the drawer is open should dismiss it rather
    // than re-focusing a body behind the overlay.
    document.getElementById('viewport').addEventListener('pointerdown', () => {
      if (this.open) this.setOpen(false);
    }, true);

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.setOpen(false);
    });
  }

  /** Move panels in or out depending on the current viewport. */
  apply() {
    const wantMobile = this.media.matches;
    if (wantMobile === this.active) return;
    this.active = wantMobile;
    document.body.classList.toggle('mobile', wantMobile);

    if (wantMobile) {
      for (const id of DRAWER_PANELS) {
        const rec = this.home.get(id);
        if (rec) this.drawerInner.appendChild(rec.el);
      }
      // Sections are collapsed on desktop to save corner space; in a scrolling
      // drawer there is room, and hidden content is just a dead end.
      for (const [hdr, body] of [['settings-hdr', 'settings-body'], ['help-hdr', 'help-body']]) {
        document.getElementById(body).style.display = '';
        document.getElementById(hdr).classList.remove('collapsed');
      }
    } else {
      this.setOpen(false);
      for (const id of DRAWER_PANELS) {
        const rec = this.home.get(id);
        if (rec) rec.parent.insertBefore(rec.el, rec.next);
      }
    }
  }

  setOpen(open) {
    this.open = open && this.active;
    this.drawer.classList.toggle('closed', !this.open);
    this.scrim.classList.toggle('closed', !this.open);
    this.drawer.setAttribute('aria-hidden', String(!this.open));
    this.toggle.setAttribute('aria-expanded', String(this.open));
  }
}
