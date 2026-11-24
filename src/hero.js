// The hero: the sculpted image-to-3D mesh, rigged in Mixamo with a run cycle (assets/models/hero.glb,
// converted from Running.fbx). It arrives white, so the concept art is projected onto it (heroMaterial),
// and the mundu fold is done in the vertex shader (shorter cloth before the skeleton moves it).
import * as THREE from 'three';
import { lit, gltfLoader } from './fx.js';

// Paint rules are written in the original sculpt's units: faces +z, feet y=-0.998, top y=0.959,
// body centred on x≈-0.02, z≈-0.05. The rigged mesh is mapped into these units by its bounding box.
const MODEL = { yMin: -0.998, yMax: 0.959, xMid: -0.0205, zMid: -0.023 };
const CX = -0.02, CZ = -0.05;
const Y = { soleTop: -0.965, shoeTop: -0.79, hem: -0.655, waist: -0.11, elbow: 0.07 };
export const HEIGHT = 2.1; // game units, same as the old character


// Body part from the Mixamo bone that moves a vertex most. The shader then picks the exact colour per
// pixel from the standing-pose height (cuff, waist, hem, shoe lines), so every border is a clean line.
const GROUP = { torso: 0, arm: 1, shin: 2, head: 3, neck: 4 };
function groupOf(bone) {
  if (bone.includes('Hand') || bone.includes('Arm') || bone.includes('Shoulder')) return GROUP.arm; // ForeArm, Arm too
  if (bone.includes('Head')) return GROUP.head;
  if (bone.includes('Neck')) return GROUP.neck;
  if (bone.includes('Foot') || bone.includes('Toe') || (bone.includes('Leg') && !bone.includes('UpLeg'))) return GROUP.shin;
  return GROUP.torso; // Hips, Spine, UpLeg
}

// Colour comes from the concept turnaround the sculpt was generated from (assets/textures/hero_*.jpg),
// projected onto the standing pose: front/back by the rest normal's z, side by its x (not on arms; the side
// sheet shows them spread). Rest positions keep the paint stuck to the body while it animates.
// PROJ = [cx, top, kx (negative = mirrored), ky]: image u = cx + coord*kx, v = top + (yMax - y)*ky, as fractions
// of the sheet. Fitted by silhouette matching; refit and re-bake if the model or the sheets change.
// The head gets its own tighter fit (H*), blended in above the chin.
const PROJ = {
  front: [0.49946, 0.04858, 0.59967, 0.45], frontH: [0.49946, 0.05689, 0.57568, 0.432],
  side: [0.49912, 0.05276, 0.59633, 0.4475], sideH: [0.48238, 0.0617, 0.57844, 0.43407],
  back: [0.50026, 0.06449, -0.58802, 0.44126], backH: [0.50026, 0.06585, -0.57038, 0.42803],
};
function heroMaterial(waistGeo) {
  const m = lit({ envMapIntensity: 0.35 }); // the painted textures already carry their lighting
  const bend = m.onBeforeCompile;
  const fold = { value: 1 };
  const load = (name) => {
    const t = new THREE.TextureLoader().load(`assets/textures/hero_${name}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  m.onBeforeCompile = (s, r) => {
    bend(s, r);
    Object.assign(s.uniforms, {
      tFront: { value: load('front') }, tSide: { value: load('side') }, tBack: { value: load('back') },
      ...Object.fromEntries(Object.entries(PROJ).map(([k, v]) => ['p' + k[0].toUpperCase() + k.slice(1), { value: new THREE.Vector4(...v) }])),
      uFold: fold, uWaist: { value: waistGeo }, uRim: { value: new THREE.Color(0xffb46b).multiplyScalar(0.45) },
    });
    s.vertexShader = `attribute vec3 aRest;
attribute float aMundu;
attribute float aGroup;
attribute vec3 aRestN;
varying vec3 vRest;
varying vec3 vRestN;
varying float vGroup;
uniform float uFold;
uniform float uWaist;
` + s.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRest = aRest; vRestN = aRestN; vGroup = aGroup;
        if (aMundu > 0.5) transformed.y = uWaist + (transformed.y - uWaist) * uFold;`);
    s.fragmentShader = `uniform sampler2D tFront, tSide, tBack;
uniform vec4 pFront, pSide, pBack, pFrontH, pSideH, pBackH;
uniform vec3 uRim;
uniform float uFold;
varying vec3 vRest;
varying vec3 vRestN;
varying float vGroup;
vec3 sheet(sampler2D t, vec4 pb, vec4 ph, float h) {
  vec4 p = mix(pb, ph, smoothstep(0.47, 0.53, vRest.y));
  return texture2D(t, vec2(p.x + h * p.z, 1.0 - (p.y + (${MODEL.yMax} - vRest.y) * p.w))).rgb;
}
` + s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 n = normalize(vRestN);
        float arm = step(0.5, vGroup) * (1.0 - step(1.5, vGroup));
        float front = smoothstep(-0.15, 0.15, n.z); // up/down-facing bits follow whichever side they lean to
        float wf = front + 1e-4, wb = 1.0 - front;
        float wx = 0.35 * pow(abs(n.x), 6.0) * (1.0 - arm) * 2.0;
        vec3 col = (sheet(tFront, pFront, pFrontH, vRest.x) * wf + sheet(tBack, pBack, pBackH, vRest.x) * wb + sheet(tSide, pSide, pSideH, vRest.z) * wx) / (wf + wb + wx);
        // Arms and hands have no white on them: backdrop picked up at thin fingers becomes skin. Hands go by
        // position too (|x| beside the mundu), since Mixamo weights some fingertips to the hips.
        float hand = max(arm, smoothstep(0.27, 0.3, abs(vRest.x))) * (1.0 - step(0.05, vRest.y)); // below the rolled cuff
        float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b)), luma = dot(col, vec3(0.333));
        float pale = smoothstep(0.45, 0.7, luma) * (1.0 - smoothstep(0.08, 0.2, sat)) * arm;
        // On a hand, grey (skin has colour) or brighter-than-skin is backdrop blended into the drawn fingers; the watch is darker.
        float grey = max(smoothstep(0.2, 0.3, luma) * (1.0 - smoothstep(0.1, 0.22, sat)), smoothstep(0.4, 0.5, luma)) * hand;
        col = mix(col, vec3(0.6, 0.234, 0.107), max(pale, grey)); // skin; texture colours here are linear, not sRGB
        // Folded mundu: the strip between the lifted hem and the knee is stretched cloth-edge geometry; show bare leg.
        col = mix(col, vec3(0.6, 0.234, 0.107), (1.0 - step(0.99, uFold)) * (1.0 - step(${(Y.hem + 0.035).toFixed(3)}, vRest.y)) * step(${Y.soleTop + 0.2}, vRest.y) * (1.0 - hand));
        diffuseColor.rgb = col;`)
      // Sunset rim light + a little lift, so he does not turn into a silhouette against the low sun.
      .replace('#include <opaque_fragment>', `outgoingLight += uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) + diffuseColor.rgb * 0.1;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'hero';
  return { material: m, fold };
}

// Returns { scene, mesh, mixer, actions, standY, lift, setFold } scaled to HEIGHT, facing +z.
// standY puts the standing (bind) pose's feet on y=0. Mixamo clips place the body differently, so
// lift[clip] is how far each clip's lowest point sits above that; subtract it to keep him on the road.
// window[clip] = [from, to] seconds actually played; ground is taken from that part only (a held end pose: from = to).
export async function loadHero(url, window = {}) {
  const gltf = await gltfLoader.loadAsync(url);
  const scene = gltf.scene;
  const mesh = scene.getObjectByProperty('isSkinnedMesh', true);
  const geo = mesh.geometry;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const b = geo.boundingBox, s = (MODEL.yMax - MODEL.yMin) / (b.max.y - b.min.y);
  const midX = (b.min.x + b.max.x) / 2, midZ = (b.min.z + b.max.z) / 2;
  const pos = geo.attributes.position, n = pos.count;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, bones = mesh.skeleton.bones;
  const rest = new Float32Array(n * 3), group = new Uint8Array(n), mundu = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (pos.getX(i) - midX) * s + MODEL.xMid - CX;
    const y = (pos.getY(i) - b.min.y) * s + MODEL.yMin;
    const z = (pos.getZ(i) - midZ) * s + MODEL.zMid - CZ;
    rest.set([x, y, z], i * 3);
    let best = 0;
    for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
    group[i] = groupOf(bones[si.getComponent(i, best)].name);
    // Mundu cloth (squashed by the fold): between hem and waist, on the torso or the legs.
    mundu[i] = y >= Y.hem && y < Y.waist && (group[i] === GROUP.torso || group[i] === GROUP.shin) ? 1 : 0;
  }
  geo.setAttribute('aRest', new THREE.BufferAttribute(rest, 3));
  // Smoothed rest normals pick the projection sheet; the sculpt's raw normals are noisy and would flick
  // between the front and back paintings across the face.
  const idx = geo.index.array;
  let nrm = Float32Array.from(geo.attributes.normal.array);
  for (let it = 0; it < 8; it++) {
    const acc = new Float32Array(nrm.length);
    for (let t = 0; t < idx.length; t += 3) {
      for (let c = 0; c < 3; c++) {
        const sx = nrm[idx[t] * 3 + c] + nrm[idx[t + 1] * 3 + c] + nrm[idx[t + 2] * 3 + c];
        acc[idx[t] * 3 + c] += sx; acc[idx[t + 1] * 3 + c] += sx; acc[idx[t + 2] * 3 + c] += sx;
      }
    }
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
      acc[i * 3] /= l; acc[i * 3 + 1] /= l; acc[i * 3 + 2] /= l;
    }
    nrm = acc;
  }
  geo.setAttribute('aRestN', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aMundu', new THREE.BufferAttribute(mundu, 1));
  // One body part per triangle (its corners' majority) so arms, head and torso never blend into each other.
  const flat = geo.toNonIndexed(), fn = flat.attributes.position.count;
  const tri = new Float32Array(fn);
  for (let t = 0; t < fn; t += 3) {
    const [a, c, d] = [group[idx[t]], group[idx[t + 1]], group[idx[t + 2]]];
    tri[t] = tri[t + 1] = tri[t + 2] = a === c || a === d ? a : c === d ? c : a;
  }
  flat.setAttribute('aGroup', new THREE.BufferAttribute(tri, 1));
  mesh.geometry = flat;
  const { material, fold } = heroMaterial(b.min.y + (Y.waist - MODEL.yMin) / s);
  mesh.material = material;
  mesh.castShadow = true;
  mesh.frustumCulled = false; // skinned bounds are not tracked

  // Size it from the standing (bind) pose.
  mesh.skeleton.pose();
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const k = HEIGHT / (box.max.y - box.min.y);
  scene.scale.multiplyScalar(k);
  scene.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));

  // Each clip's lowest point over its whole length (sampled, every 7th vertex) = where its ground is.
  const v = new THREE.Vector3(), lift = {};
  const lowest = () => {
    scene.updateMatrixWorld(true);
    let m = Infinity;
    for (let i = 0; i < fn; i += 13) { mesh.getVertexPosition(i, v); m = Math.min(m, v.applyMatrix4(mesh.matrixWorld).y); }
    return m;
  };
  for (const [name, act] of Object.entries(actions)) {
    mixer.stopAllAction();
    act.reset().play();
    const [a, b] = window[name] ?? [0, act.getClip().duration];
    let m = Infinity;
    for (let t = 0; t <= 16; t++) { mixer.setTime(a + ((b - a) * t) / 16); m = Math.min(m, lowest()); }
    lift[name] = m;
  }
  if (lift.jump != null) lift.jump = lift.run; // the jump's hips are held at standing height, so it shares the run's ground
  mixer.stopAllAction();
  mesh.skeleton.pose();
  return { scene, mesh, mixer, actions, standY: scene.position.y, lift, setFold: (val) => { fold.value = val; } };
}
