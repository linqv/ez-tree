import * as THREE from 'three';
import { TreePreset } from '@dgreenheck/ez-tree';

// Bark keys are kept for preset compatibility. Rain Scene uses generated
// fallback textures so it can run without Git LFS texture downloads.
export const BarkType = {
  Bark001: 'Bark001',
  Bark002: 'Bark002',
  Bark003: 'Bark003',
  Bark004: 'Bark004',
  Bark006: 'Bark006',
  Bark007: 'Bark007',
  Bark008: 'Bark008',
  Bark012: 'Bark012',
  Bark013: 'Bark013',
  Bark014: 'Bark014',
  Bark015: 'Bark015',
};

export const LeafType = {
  Ash: 'ash',
  Aspen: 'aspen',
  Oak: 'oak',
  Pine: 'pine',
};

const barkCache = new Map();
const leafCache = new Map();

function createFallbackTexture(colors, colorSpace = THREE.NoColorSpace) {
  const size = Math.sqrt(colors.length / 4);
  const texture = new THREE.DataTexture(new Uint8Array(colors), size, size);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  return texture;
}

function createBarkColorTexture(type) {
  const palettes = {
    Bark001: [88, 71, 55, 255, 57, 44, 34, 255, 115, 92, 70, 255, 43, 35, 29, 255],
    Bark002: [96, 82, 64, 255, 62, 50, 39, 255, 124, 108, 82, 255, 49, 40, 32, 255],
    Bark003: [78, 61, 48, 255, 43, 34, 27, 255, 104, 82, 62, 255, 35, 29, 24, 255],
    Bark004: [99, 73, 51, 255, 59, 43, 31, 255, 129, 96, 67, 255, 42, 32, 25, 255],
    Bark006: [91, 83, 70, 255, 55, 50, 43, 255, 118, 108, 91, 255, 42, 38, 34, 255],
    Bark007: [70, 61, 52, 255, 43, 37, 32, 255, 92, 82, 70, 255, 34, 30, 27, 255],
    Bark008: [105, 86, 66, 255, 66, 53, 41, 255, 132, 110, 84, 255, 49, 40, 33, 255],
    Bark012: [82, 72, 62, 255, 50, 43, 38, 255, 108, 96, 82, 255, 37, 33, 30, 255],
    Bark013: [86, 65, 49, 255, 52, 39, 30, 255, 113, 86, 64, 255, 38, 30, 25, 255],
    Bark014: [75, 66, 55, 255, 46, 40, 34, 255, 100, 88, 73, 255, 35, 31, 27, 255],
    Bark015: [95, 77, 57, 255, 58, 47, 35, 255, 122, 99, 73, 255, 43, 36, 29, 255],
  };
  return createFallbackTexture(palettes[type] ?? palettes.Bark001, THREE.SRGBColorSpace);
}

function createLeafTexture(type) {
  const palettes = {
    ash: [[42, 90, 37], [78, 143, 55]],
    aspen: [[70, 126, 49], [124, 174, 73]],
    oak: [[37, 84, 31], [78, 131, 49]],
    pine: [[30, 76, 42], [54, 120, 66]],
  };

  const [dark, light] = palettes[type] ?? palettes.ash;
  const size = 32;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const dx = (u - 0.5) / 0.34;
      const dy = (v - 0.5) / 0.48;
      const d = dx * dx + dy * dy;
      const edge = 1 - THREE.MathUtils.smoothstep(d, 0.68, 0.98);
      const vein = Math.max(0, 1 - Math.abs(u - 0.5) * 18) * edge;
      const shade = 0.25 + 0.75 * v;
      const offset = (y * size + x) * 4;

      data[offset] = Math.round(THREE.MathUtils.lerp(dark[0], light[0], shade) + vein * 20);
      data[offset + 1] = Math.round(THREE.MathUtils.lerp(dark[1], light[1], shade) + vein * 28);
      data[offset + 2] = Math.round(THREE.MathUtils.lerp(dark[2], light[2], shade) + vein * 12);
      data[offset + 3] = Math.round(edge * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true;
  return texture;
}

/**
 * Returns a cached set of THREE.Texture maps for the given bark type.
 * @param {string} type - one of BarkType values
 * @returns {{ color: THREE.Texture, ao: THREE.Texture, normal: THREE.Texture, roughness: THREE.Texture } | null}
 */
export function getBarkMaps(type) {
  if (!BarkType[type]) return null;
  if (barkCache.has(type)) return barkCache.get(type);

  const maps = {
    color: createBarkColorTexture(type),
    ao: createFallbackTexture([255, 255, 255, 255]),
    normal: createFallbackTexture([128, 128, 255, 255]),
    roughness: createFallbackTexture([190, 190, 190, 255]),
  };
  barkCache.set(type, maps);
  return maps;
}

/**
 * Returns a cached leaf color texture for the given leaf type.
 * @param {string} type - one of LeafType values
 * @returns {THREE.Texture | null}
 */
export function getLeafMap(type) {
  if (leafCache.has(type)) return leafCache.get(type);
  const texture = createLeafTexture(type);
  leafCache.set(type, texture);
  return texture;
}

/**
 * Assigns bark + leaf textures onto the tree's options based on its current
 * `bark.type` and `leaves.type` identifiers. Call this before `tree.generate()`
 * whenever the type strings change.
 * @param {import('@dgreenheck/ez-tree').Tree} tree
 */
export function applyTreeTextures(tree) {
  const barkMaps = getBarkMaps(tree.options.bark.type);
  if (barkMaps) {
    tree.options.bark.maps.color = barkMaps.color;
    tree.options.bark.maps.ao = barkMaps.ao;
    tree.options.bark.maps.normal = barkMaps.normal;
    tree.options.bark.maps.roughness = barkMaps.roughness;
  }
  tree.options.leaves.map = getLeafMap(tree.options.leaves.type);
}

/**
 * Loads a named preset onto the tree, applying the matching texture set in
 * the same step so the first generate sees the textures.
 * @param {import('@dgreenheck/ez-tree').Tree} tree
 * @param {string} name - key into TreePreset registry
 */
export function loadPresetWithTextures(tree, name) {
  const json = structuredClone(TreePreset[name]);
  if (!json) return;
  tree.options.copy(json);
  applyTreeTextures(tree);
  tree.generate();
}
