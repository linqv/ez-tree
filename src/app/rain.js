import * as THREE from 'three';

function mapLinear(value, inMin, inMax, outMin, outMax) {
  return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
}

export class Rain extends THREE.Object3D {
  constructor(camera, options = {}) {
    super();

    this.camera = camera;
    this.progress = options.progress ?? 0;
    this.fadeDuration = options.fadeDuration ?? 5;
    this.dropCount = options.dropCount ?? 2200;
    this.splashCount = options.splashCount ?? 900;
    this.radius = options.radius ?? 150;
    this.height = options.height ?? 180;
    this.dropSpeed = options.dropSpeed ?? 95;
    this.splashSpeed = options.splashSpeed ?? 2.5;

    this.dummy = new THREE.Object3D();
    this.dropData = [];
    this.splashData = [];

    this.name = 'Rain';

    this.createPuddleOverlay();
    this.createDrops();
    this.createSplashes();
  }

  createPuddleOverlay() {
    this.puddleMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uRainProgress: { value: this.progress },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorldUv;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldUv = worldPosition.xz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uRainProgress;
        varying vec2 vWorldUv;

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 19.19);
          return fract((p3.x + p3.y) * p3.z);
        }

        vec2 hash22(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          p3 += dot(p3, p3.yzx + 19.19);
          return fract((p3.xx + p3.yz) * p3.zy);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);

          float a = hash12(i);
          float b = hash12(i + vec2(1.0, 0.0));
          float c = hash12(i + vec2(0.0, 1.0));
          float d = hash12(i + vec2(1.0, 1.0));

          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;

          for (int i = 0; i < 4; i++) {
            value += amplitude * valueNoise(p);
            p *= 2.0;
            amplitude *= 0.5;
          }

          return value;
        }

        float ripple(vec2 uv) {
          vec2 cell = floor(uv);
          float sum = 0.0;

          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 neighbor = vec2(float(x), float(y));
              vec2 point = cell + neighbor + hash22(cell + neighbor);
              float t = fract(uTime * 0.55 + hash12(cell + neighbor));
              float d = length(point - uv) - t * 1.8;
              float ring = sin(d * 36.0) * smoothstep(0.08, 0.0, abs(d));
              sum += ring * (1.0 - t);
            }
          }

          return sum;
        }

        void main() {
          float rainProgress = smoothstep(0.0, 1.0, uRainProgress);
          float puddleMask = smoothstep(0.58, 0.86, fbm(vWorldUv * 0.018 + vec2(3.0, 0.0)));
          float distanceFade = 1.0 - smoothstep(135.0, 230.0, length(vWorldUv));
          float rippleLight = ripple(vWorldUv * 0.11);

          vec3 base = vec3(0.06, 0.10, 0.12);
          vec3 highlight = vec3(0.38, 0.50, 0.58) * max(rippleLight, 0.0);
          float alpha = (0.08 + puddleMask * 0.20 + max(rippleLight, 0.0) * 0.12) * rainProgress * distanceFade;

          gl_FragColor = vec4(base + highlight, alpha);
        }
      `,
    });

    const puddle = new THREE.Mesh(
      new THREE.PlaneGeometry(460, 460, 1, 1),
      this.puddleMaterial
    );
    puddle.name = 'RainPuddleOverlay';
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.y = 0.025;
    puddle.renderOrder = 1;
    this.add(puddle);
  }

  createDrops() {
    const geometry = new THREE.PlaneGeometry(0.16, 3.8);
    const material = new THREE.MeshBasicMaterial({
      color: 0xc7e4ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.dropMesh = new THREE.InstancedMesh(geometry, material, this.dropCount);
    this.dropMesh.name = 'RainDrops';
    this.dropMesh.frustumCulled = false;
    this.dropMesh.renderOrder = 2;

    for (let i = 0; i < this.dropCount; i++) {
      this.resetDrop(i, true);
      this.writeDropMatrix(i);
    }

    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.add(this.dropMesh);
  }

  createSplashes() {
    const texture = new THREE.TextureLoader().load('/Splash.png');
    texture.colorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.PlaneGeometry(2.1, 1.0);
    this.splashProgress = new Float32Array(this.splashCount);
    geometry.setAttribute(
      'aSplashProgress',
      new THREE.InstancedBufferAttribute(this.splashProgress, 1)
    );

    this.splashMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uFlipBook: { value: texture },
        uRainProgress: { value: this.progress },
      },
      vertexShader: /* glsl */ `
        attribute float aSplashProgress;
        varying vec2 vUv;
        varying float vSplashProgress;

        void main() {
          vUv = uv;
          vSplashProgress = aSplashProgress;
          vec3 transformed = position;
          transformed.y += 0.08;

          #ifdef USE_INSTANCING
            vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          #else
            vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
          #endif

          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFlipBook;
        uniform float uRainProgress;
        varying vec2 vUv;
        varying float vSplashProgress;

        float fmod(float x, float y) {
          return x - y * floor(x / y);
        }

        vec2 getFlipbookUv(vec2 uv, float width, float height, float tile) {
          tile = fmod(tile, width * height);
          vec2 tileCount = vec2(1.0) / vec2(width, height);
          float tileY = abs(height - (floor(tile * tileCount.x) + 1.0));
          float tileX = tile - width * floor(tile * tileCount.x);
          return (uv + vec2(tileX, tileY)) * tileCount;
        }

        void main() {
          float progress = 1.0 - clamp((vSplashProgress - 0.0) / 0.3, 0.0, 1.0);
          float tile = floor(progress * 20.0);
          vec4 texel = texture2D(uFlipBook, getFlipbookUv(vUv, 4.0, 5.0, tile));
          float rainProgress = smoothstep(0.0, 1.0, uRainProgress);

          gl_FragColor = vec4(vec3(0.72, 0.88, 1.0) * texel.a, texel.a * 0.16 * rainProgress);
        }
      `,
    });

    this.splashMesh = new THREE.InstancedMesh(
      geometry,
      this.splashMaterial,
      this.splashCount
    );
    this.splashMesh.name = 'RainSplashes';
    this.splashMesh.frustumCulled = false;
    this.splashMesh.renderOrder = 3;

    for (let i = 0; i < this.splashCount; i++) {
      this.resetSplash(i, true);
      this.writeSplashMatrix(i);
    }

    this.splashMesh.instanceMatrix.needsUpdate = true;
    this.add(this.splashMesh);
  }

  resetDrop(index, randomizeHeight = false) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * this.radius;
    const scale = THREE.MathUtils.randFloat(0.45, 1.1);

    this.dropData[index] = {
      x: Math.cos(angle) * distance,
      y: randomizeHeight ? Math.random() * this.height : this.height,
      z: Math.sin(angle) * distance,
      scale,
      speed: this.dropSpeed * THREE.MathUtils.randFloat(0.75, 1.25),
    };
  }

  writeDropMatrix(index) {
    const drop = this.dropData[index];
    this.dummy.position.set(drop.x, drop.y, drop.z);
    this.dummy.rotation.set(0, this.camera.rotation.y, -0.16);
    this.dummy.scale.set(drop.scale, drop.scale, drop.scale);
    this.dummy.updateMatrix();
    this.dropMesh.setMatrixAt(index, this.dummy.matrix);
  }

  resetSplash(index, randomizeTimer = false) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * (this.radius * 0.95);
    const start = randomizeTimer
      ? THREE.MathUtils.randFloat(-0.1, 2)
      : THREE.MathUtils.randFloat(0.6, 2);

    this.splashData[index] = {
      x: Math.cos(angle) * distance,
      y: 0.03,
      z: Math.sin(angle) * distance,
      timer: start,
      initialTimer: start,
      scale: THREE.MathUtils.randFloat(1.7, 4.2),
    };
  }

  writeSplashMatrix(index) {
    const splash = this.splashData[index];
    const worldX = splash.x + this.position.x;
    const worldZ = splash.z + this.position.z;

    this.dummy.position.set(splash.x, splash.y, splash.z);
    this.dummy.rotation.set(
      0,
      Math.atan2(this.camera.position.x - worldX, this.camera.position.z - worldZ),
      0
    );
    this.dummy.scale.setScalar(splash.scale);
    this.dummy.updateMatrix();
    this.splashMesh.setMatrixAt(index, this.dummy.matrix);
  }

  update(elapsedTime, deltaTime) {
    this.progress = Math.min(1, this.progress + deltaTime / this.fadeDuration);

    this.position.x = this.camera.position.x;
    this.position.z = this.camera.position.z;

    this.dropMesh.material.opacity = 0.18 * this.progress;
    this.puddleMaterial.uniforms.uTime.value = elapsedTime;
    this.puddleMaterial.uniforms.uRainProgress.value = this.progress;
    this.splashMaterial.uniforms.uRainProgress.value = this.progress;

    for (let i = 0; i < this.dropCount; i++) {
      const drop = this.dropData[i];
      drop.y -= deltaTime * drop.speed;

      if (drop.y < -3) {
        this.resetDrop(i);
      }

      this.writeDropMatrix(i);
    }

    for (let i = 0; i < this.splashCount; i++) {
      const splash = this.splashData[i];
      splash.timer -= deltaTime * this.splashSpeed;

      if (splash.timer < -0.2) {
        this.resetSplash(i);
      }

      this.splashProgress[i] = mapLinear(splash.timer, splash.initialTimer, -0.2, 1, 0);
      this.writeSplashMatrix(i);
    }

    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.splashMesh.instanceMatrix.needsUpdate = true;
    this.splashMesh.geometry.attributes.aSplashProgress.needsUpdate = true;
  }
}
