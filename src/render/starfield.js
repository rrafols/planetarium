/**
 * Milky Way backdrop.
 *
 * The source panorama is in *galactic* coordinates — the galactic plane runs
 * dead straight across the middle of the image with the bulge at its centre —
 * so pasting it onto a sphere unrotated would put the galactic plane on the
 * ecliptic, which is wrong by about 60 degrees. We build the galactic basis
 * explicitly and rotate it into the scene frame.
 */

import {
  Mesh, SphereGeometry, MeshBasicMaterial, BackSide, Vector3, Matrix4,
} from 'three';
import { DEG } from '../core/constants.js';
import { equatorialToEcliptic } from '../ephem/rotation.js';
import { ECL_TO_SCENE } from '../ephem/system.js';

const RADIUS = 1e8;

// J2000 definition of the galactic frame.
const NGP_RA = 192.85948 * DEG;
const NGP_DEC = 27.12825 * DEG;
const GC_RA = 266.405 * DEG;
const GC_DEC = -28.93617 * DEG;

function unitFromRaDec(ra, dec) {
  const cd = Math.cos(dec);
  return new Vector3(cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec));
}

function galacticToSceneMatrix() {
  const xGal = equatorialToEcliptic(unitFromRaDec(GC_RA, GC_DEC)).applyMatrix4(ECL_TO_SCENE);
  const zGal = equatorialToEcliptic(unitFromRaDec(NGP_RA, NGP_DEC)).applyMatrix4(ECL_TO_SCENE);
  // Re-orthogonalise: the tabulated pole and centre are not exactly perpendicular.
  xGal.addScaledVector(zGal, -xGal.dot(zGal)).normalize();
  const yGal = new Vector3().crossVectors(zGal, xGal).normalize();

  // Three.js sphere UVs put u = 0.5 on local +X and the north pole on local +Y,
  // with u increasing as a right-handed rotation about +Y. Matching that to
  // (l = 0, b = 0) on +X and the NGP on +Y forces local +Z onto -y_galactic.
  return new Matrix4().makeBasis(xGal, zGal, yGal.clone().negate());
}

export class Starfield {
  constructor(scene, texture) {
    const geo = new SphereGeometry(RADIUS, 64, 32);
    this.material = new MeshBasicMaterial({
      map: texture,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false, // tone mapping happens once, in OutputPass
      fog: false,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    // The sphere is centred on the camera, which never leaves the scene origin,
    // so the transform is pure rotation and never needs recomputing.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(galacticToSceneMatrix());
    this.mesh.matrixWorld.copy(this.mesh.matrix);
    scene.add(this.mesh);
  }

  setTexture(tex) {
    this.material.map = tex;
    this.material.needsUpdate = true;
  }

  setBrightness(v) {
    this.material.color.setScalar(v);
  }

  setVisible(v) {
    this.mesh.visible = v;
  }
}
