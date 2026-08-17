/**
 * HTML labels projected onto body positions.
 *
 * DOM elements rather than sprites: they stay crisp at any zoom, cost nothing
 * to lay out, and can be styled with plain CSS. The only real work is deciding
 * when to hide one — a label is dropped when its body is behind the camera,
 * occluded by whatever we are orbiting, or so large on screen that the name
 * would sit uselessly in the middle of the planet.
 */

import { Vector3 } from 'three';
import { BODIES } from '../data/bodies.js';

const _v = new Vector3();
const _p = new Vector3();

export class Labels {
  constructor(container) {
    this.container = container;
    this.items = new Map();
    this.visible = true;

    for (const def of BODIES) {
      const el = document.createElement('div');
      el.className = `label label-${def.kind}`;
      el.dataset.key = def.key;

      const dot = document.createElement('i');
      const text = document.createElement('span');
      text.textContent = def.name;
      el.append(dot, text);

      container.appendChild(el);
      this.items.set(def.key, { el, def, shown: false });
    }
  }

  setVisible(v) {
    this.visible = v;
    this.container.style.display = v ? '' : 'none';
  }

  /** @param {(key:string)=>void} onClick */
  onSelect(handler) {
    this.container.addEventListener('click', (e) => {
      const el = e.target.closest('.label');
      if (el) handler(el.dataset.key);
    });
  }

  /**
   * @param {import('three').Camera} camera
   * @param {import('../render/scene.js').SceneBuilder} builder
   * @param {string} focusKey
   * @param {{width:number, height:number}} size
   */
  update(camera, builder, focusKey, size) {
    if (!this.visible) return;

    const halfW = size.width / 2;
    const halfH = size.height / 2;

    for (const [key, item] of this.items) {
      const entry = builder.bodies.get(key);
      const pos = entry.group.position; // already origin-relative
      const dist = pos.length();

      _v.copy(pos).project(camera);

      // Behind the camera, or off screen.
      const onScreen = _v.z < 1 && Math.abs(_v.x) < 1.25 && Math.abs(_v.y) < 1.25;

      // Angular size: hide the label once the body is big enough to read directly.
      const angular = dist > 0 ? entry.drawRadius / dist : 1;
      const tooBig = angular > 0.22;
      const isFocus = key === focusKey;

      let show = onScreen && !tooBig && (isFocus || dist > entry.drawRadius * 1.5);

      // A moon's label is only useful once it is visibly separated from its
      // planet; otherwise seven Saturnian names land on top of each other.
      if (show && !isFocus && item.def.kind === 'moon' && item.def.parent) {
        const parent = builder.bodies.get(item.def.parent);
        if (parent) {
          _p.copy(parent.group.position).project(camera);
          const dx = (_v.x - _p.x) * halfW;
          const dy = (_v.y - _p.y) * halfH;
          if (Math.hypot(dx, dy) < 34) show = false;
        }
      }

      if (!show) {
        if (item.shown) {
          item.el.style.display = 'none';
          item.shown = false;
        }
        continue;
      }

      // Push the label clear of the body's disc rather than letting it land on
      // top of the planet once you are close enough for it to fill the view.
      const screenRadius = (angular / Math.tan(camera.fov * Math.PI / 360)) * halfH;
      const x = _v.x * halfW + halfW + Math.min(screenRadius, halfW * 0.5);
      const y = -_v.y * halfH + halfH;
      item.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      item.el.classList.toggle('is-focus', isFocus);

      // Fade distant moons out so Jupiter is not a wall of text.
      const faint = item.def.kind === 'moon' && angular < 0.0015;
      item.el.style.opacity = faint ? '0.35' : '1';

      if (!item.shown) {
        item.el.style.display = 'flex';
        item.shown = true;
      }
    }
  }
}
