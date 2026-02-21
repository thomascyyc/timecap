// ── Mode & Session ───────────────────────────────────────────────

const MODE_KEY = 'timecap_mode';       // 'individual' | 'workshop'
const SESSION_KEY = 'timecap_session'; // { code, participantToken, name }

function getMode() {
  return sessionStorage.getItem(MODE_KEY) || null;
}

function setMode(mode) {
  sessionStorage.setItem(MODE_KEY, mode);
}

function getWorkshopSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch { return null; }
}

function setWorkshopSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

// ── Landing overlay ──────────────────────────────────────────────

(function initLanding() {
  const landingOverlay = document.getElementById('landing-overlay');
  const landingChoices = document.getElementById('landing-choices');
  const joinFlow = document.getElementById('join-flow');
  const btnIndividual = document.getElementById('btn-individual');
  const btnJoin = document.getElementById('btn-join');
  const btnJoinSubmit = document.getElementById('btn-join-submit');
  const btnJoinBack = document.getElementById('btn-join-back');
  const roomCodeInput = document.getElementById('room-code-input');
  const nameInput = document.getElementById('participant-name-input');
  const joinError = document.getElementById('join-error');

  function dismissLanding() {
    landingOverlay.classList.add('dismissing');
    setTimeout(() => landingOverlay.remove(), 700);
  }

  btnIndividual.addEventListener('click', () => {
    setMode('individual');
    dismissLanding();
  });

  btnJoin.addEventListener('click', () => {
    landingChoices.classList.add('hidden');
    joinFlow.classList.remove('hidden');
    setTimeout(() => roomCodeInput.focus(), 100);
  });

  btnJoinBack.addEventListener('click', () => {
    joinFlow.classList.add('hidden');
    landingChoices.classList.remove('hidden');
    joinError.classList.add('hidden');
    roomCodeInput.value = '';
    nameInput.value = '';
  });

  roomCodeInput.addEventListener('input', () => {
    roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  async function attemptJoin() {
    const code = roomCodeInput.value.trim().toUpperCase();
    const name = nameInput.value.trim();

    if (code.length !== 6) {
      showJoinError('Please enter a 6-character room code.');
      return;
    }

    joinError.classList.add('hidden');
    btnJoinSubmit.disabled = true;
    btnJoinSubmit.textContent = 'Joining...';

    try {
      const res = await fetch(`/api/session-status?code=${encodeURIComponent(code)}`);
      if (res.status === 404) {
        showJoinError('Room not found. Check your code and try again.');
        return;
      }
      if (!res.ok) {
        showJoinError('Something went wrong. Please try again.');
        return;
      }
      const data = await res.json();
      if (data.status !== 'open') {
        showJoinError('This session is no longer accepting participants.');
        return;
      }

      const participantToken = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setMode('workshop');
      setWorkshopSession({ code, participantToken, name });
      dismissLanding();
    } catch {
      showJoinError('Connection error. Please try again.');
    } finally {
      btnJoinSubmit.disabled = false;
      btnJoinSubmit.textContent = 'Enter room';
    }
  }

  function showJoinError(msg) {
    joinError.textContent = msg;
    joinError.classList.remove('hidden');
  }

  btnJoinSubmit.addEventListener('click', attemptJoin);
  roomCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptJoin();
  });

  // Pre-fill code from ?join=CODE query param (facilitator share link)
  const urlParams = new URLSearchParams(location.search);
  const joinCode = urlParams.get('join');
  if (joinCode) {
    landingChoices.classList.add('hidden');
    joinFlow.classList.remove('hidden');
    roomCodeInput.value = joinCode.toUpperCase().slice(0, 6);
    setTimeout(() => nameInput.focus(), 100);
  }
})();

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// ── State ───────────────────────────────────────────────────────

let crystal, crystalGeometry, crystalMaterial, glowMesh;
let innerLight, burstLight;
let fractured = false;
let fractureStartTime = 0;
const fracturePieces = [];
let hoverTarget = 0;
let hoverCurrent = 0;
let pointerDownPos = null;

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Step 4: Smoothed pointer for parallax + aurora
const pointerSmooth = new THREE.Vector2(0, 0);

// Step 7: Fracture effect state
let fractureFlashTime = -1;
let fractureParticles = null;

// Step 5: Aurora mesh
let auroraMesh = null;

// ── Questions ───────────────────────────────────────────────────

const QUESTIONS = [
  'What do you believe to be true right now?',
  'What are you most uncertain about?',
  'What would have to happen for that uncertainty to resolve?',
];

const REVEAL_LABELS = [
  'You believed',
  'You were uncertain about',
  'For it to resolve, you needed',
];

// ── Scene Setup ─────────────────────────────────────────────────

const container = document.getElementById('canvas-container');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x050508);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 4);
camera.lookAt(0, 0, 0);

// ── Lights ──────────────────────────────────────────────────────

const ambient = new THREE.AmbientLight(0x111122, 0.5);
scene.add(ambient);

const blueLight = new THREE.PointLight(0x8888ff, 0.6, 20);
blueLight.position.set(2, 3, 4);
scene.add(blueLight);

const goldLight = new THREE.PointLight(0xffddaa, 0.3, 20);
goldLight.position.set(-3, -1, 2);
scene.add(goldLight);

innerLight = new THREE.PointLight(0x6644cc, 0.4, 8);
innerLight.position.set(0, 0, 0);
scene.add(innerLight);

// ── Crystal Geometry ────────────────────────────────────────────

const crystalPoints = [
  new THREE.Vector3( 0.0,   1.35,  0.05),
  new THREE.Vector3( 0.15, -1.15,  0.1),
  new THREE.Vector3( 0.95,  0.3,   0.35),
  new THREE.Vector3(-0.7,   0.55,  0.6),
  new THREE.Vector3(-0.55, -0.4,  -0.8),
  new THREE.Vector3( 0.6,  -0.65, -0.5),
  new THREE.Vector3(-0.35,  0.85, -0.4),
  new THREE.Vector3( 0.45,  0.6,  -0.7),
  new THREE.Vector3(-0.85, -0.2,   0.3),
  new THREE.Vector3( 0.1,   0.15,  1.05),
];

crystalGeometry = new ConvexGeometry(crystalPoints);
crystalGeometry = crystalGeometry.toNonIndexed();
// Step 2: Required for reflection/refraction varyings
crystalGeometry.computeVertexNormals();

// ── Crystal Shader (Step 2: upgraded with refraction, iridescence, caustics) ──

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;
  varying vec3 vNormal;
  varying vec3 vReflect;
  varying vec3 vRefract;
  varying float vFresnel;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(cameraPosition - worldPos.xyz);

    // Reflection and refraction vectors
    vec3 I = -vViewDirection;
    vReflect = reflect(I, vNormal);
    vRefract = refract(I, vNormal, 1.0 / 1.31); // IOR 1.31 for ice

    // Schlick Fresnel approximation
    float cosTheta = max(dot(vViewDirection, vNormal), 0.0);
    float r0 = pow((1.0 - 1.31) / (1.0 + 1.31), 2.0);
    vFresnel = r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uHover;
  uniform float uOpacity;
  uniform sampler2D uEnvMap;
  uniform float uEnvIntensity;

  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;
  varying vec3 vNormal;
  varying vec3 vReflect;
  varying vec3 vRefract;
  varying float vFresnel;

  // Equirectangular sampling for HDRI
  vec3 sampleEnv(vec3 dir) {
    float phi = atan(dir.z, dir.x);
    float theta = asin(clamp(dir.y, -1.0, 1.0));
    vec2 uv = vec2(phi / 6.2832 + 0.5, theta / 3.1416 + 0.5);
    return texture2D(uEnvMap, uv).rgb;
  }

  void main() {
    // Flat face normal from screen-space derivatives
    vec3 faceNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));

    // Fresnel rim glow (original)
    float fresnel = 1.0 - max(dot(vViewDirection, faceNormal), 0.0);
    fresnel = pow(fresnel, 2.5);

    // Interior glow pulse — slow sine between deep violet and cool blue
    float pulse = 0.5 + 0.5 * sin(uTime * 0.8);
    float pulse2 = 0.5 + 0.5 * sin(uTime * 1.3 + 1.0);
    vec3 innerGlow = mix(
      vec3(0.15, 0.1, 0.4),
      vec3(0.2, 0.3, 0.8),
      pulse * 0.7 + pulse2 * 0.3
    );

    // Face-dependent color shifting
    float faceFactor = dot(faceNormal, vec3(0.3, 0.7, 0.5));
    float colorShift = sin(uTime * 0.3 + faceFactor * 6.28) * 0.5 + 0.5;

    vec3 iceBlue    = vec3(0.6, 0.85, 1.0);
    vec3 paleViolet = vec3(0.7, 0.5, 0.9);
    vec3 gold       = vec3(0.9, 0.8, 0.4);

    vec3 faceColor;
    if (colorShift < 0.33) {
      faceColor = mix(iceBlue, paleViolet, colorShift * 3.0);
    } else if (colorShift < 0.66) {
      faceColor = mix(paleViolet, gold, (colorShift - 0.33) * 3.0);
    } else {
      faceColor = mix(gold, iceBlue, (colorShift - 0.66) * 3.0);
    }

    // ── Step 2: Thin-film iridescence ──
    float iriAngle = max(dot(vViewDirection, vNormal), 0.0);
    float filmThickness = 1.8 + 0.5 * sin(uTime * 0.4 + faceFactor * 3.0);
    vec3 iridescence = vec3(
      0.5 + 0.5 * cos(filmThickness * 6.28 * iriAngle + 0.0),
      0.5 + 0.5 * cos(filmThickness * 6.28 * iriAngle + 2.094),
      0.5 + 0.5 * cos(filmThickness * 6.28 * iriAngle + 4.189)
    );
    // Iridescence strongest at glancing angles
    float iriStrength = pow(1.0 - iriAngle, 3.0) * 0.4;

    // ── Step 2: Internal caustics ──
    vec3 wp = vWorldPosition * 3.0 + uTime * 0.15;
    float caustic = sin(wp.x * 2.1 + sin(wp.z * 1.7 + uTime * 0.3)) *
                    sin(wp.y * 1.9 + sin(wp.x * 2.3 + uTime * 0.2)) *
                    sin(wp.z * 2.5 + sin(wp.y * 1.5 + uTime * 0.4));
    caustic = pow(max(caustic, 0.0), 1.5) * 0.35;
    vec3 causticColor = vec3(0.5, 0.7, 1.0) * caustic;

    // ── Step 2: Refraction tint ──
    vec3 refractTint = vec3(
      0.9 + vRefract.x * 0.1,
      0.95 + vRefract.y * 0.05,
      1.0 + vRefract.z * 0.1
    ) * 0.15;

    // ── Step 3: Environment reflection sampling ──
    vec3 envColor = vec3(0.0);
    if (uEnvIntensity > 0.0) {
      envColor = sampleEnv(vReflect) * uEnvIntensity;
    }

    // Combine: inner glow at face centers, color at edges, Fresnel rim
    float depth = 1.0 - fresnel;
    vec3 color = mix(faceColor * 0.4, innerGlow, depth * 0.6);
    color += fresnel * vec3(0.4, 0.5, 1.0) * (0.8 + uHover * 0.4);

    // Layer new effects
    color += iridescence * iriStrength;
    color += causticColor * depth;
    color += refractTint;
    color += envColor * vFresnel * 0.5;

    // Semi-transparent with stronger edges
    float alpha = 0.65 + fresnel * 0.35;
    alpha *= uOpacity;

    gl_FragColor = vec4(color, alpha);
  }
`;

crystalMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uHover: { value: 0 },
    uOpacity: { value: 1.0 },
    uEnvMap: { value: null },
    uEnvIntensity: { value: 0.0 },
  },
  transparent: true,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);
scene.add(crystal);

// ── Outer Glow Mesh ─────────────────────────────────────────────

const glowVertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vViewDirection = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const glowFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uHover;

  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;

  void main() {
    vec3 faceNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    float fresnel = 1.0 - max(dot(vViewDirection, faceNormal), 0.0);
    fresnel = pow(fresnel, 1.5);

    float pulse = 0.5 + 0.5 * sin(uTime * 0.8);
    vec3 glowColor = mix(
      vec3(0.2, 0.15, 0.5),
      vec3(0.15, 0.25, 0.7),
      pulse
    );

    float alpha = fresnel * 0.25 * (1.0 + uHover * 0.3);
    gl_FragColor = vec4(glowColor, alpha);
  }
`;

const glowMaterial = new THREE.ShaderMaterial({
  vertexShader: glowVertexShader,
  fragmentShader: glowFragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uHover: { value: 0 },
  },
  transparent: true,
  side: THREE.FrontSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

glowMesh = new THREE.Mesh(crystalGeometry, glowMaterial);
glowMesh.scale.setScalar(1.15);
scene.add(glowMesh);

// ── Step 5: Aurora Hover Effect ─────────────────────────────────

const auroraVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const auroraFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uHover;
  uniform vec2 uPointer;

  varying vec2 vUv;

  vec3 hsvToRgb(float h, float s, float v) {
    vec3 c = vec3(h, s, v);
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z * mix(vec3(1.0), rgb, c.y);
  }

  void main() {
    vec2 center = vec2(0.5) + uPointer * 0.15;
    float dist = distance(vUv, center);

    // Ring shape
    float ring = smoothstep(0.45, 0.3, dist) * smoothstep(0.05, 0.2, dist);

    // Hue cycling through icy blue-green palette (hue 0.5-0.7)
    float hue = 0.5 + 0.1 * sin(uTime * 0.4 + dist * 5.0) + 0.05 * sin(uTime * 0.7);

    // Flicker
    float flicker = 0.7 + 0.3 * sin(uTime * 3.7 + dist * 8.0) * sin(uTime * 2.1);

    vec3 color = hsvToRgb(hue, 0.6, 1.0);

    float alpha = ring * uHover * flicker * 0.35;

    gl_FragColor = vec4(color, alpha);
  }
`;

const auroraGeo = new THREE.PlaneGeometry(4, 4);
const auroraMat = new THREE.ShaderMaterial({
  vertexShader: auroraVertexShader,
  fragmentShader: auroraFragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uHover: { value: 0 },
    uPointer: { value: new THREE.Vector2(0, 0) },
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});

auroraMesh = new THREE.Mesh(auroraGeo, auroraMat);
auroraMesh.position.z = -0.5;
scene.add(auroraMesh);

// ── Step 1: Post-Processing Pipeline ────────────────────────────

const composer = new EffectComposer(renderer);

// Render pass
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Bloom pass
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.8,   // strength
  0.4,   // radius
  0.25   // threshold
);
composer.addPass(bloomPass);

// Chromatic Aberration shader
const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 1.0 },
    uTime: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uTime;
    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5);
      vec2 dir = vUv - center;
      float dist = length(dir);

      // Radial offset stronger at screen edges + subtle temporal wobble
      float wobble = 1.0 + 0.15 * sin(uTime * 1.7) * sin(uTime * 0.9);
      float offset = dist * 0.006 * uIntensity * wobble;

      vec2 rUv = vUv + dir * offset;
      vec2 gUv = vUv;
      vec2 bUv = vUv - dir * offset;

      float r = texture2D(tDiffuse, rUv).r;
      float g = texture2D(tDiffuse, gUv).g;
      float b = texture2D(tDiffuse, bUv).b;

      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

const caPass = new ShaderPass(ChromaticAberrationShader);
composer.addPass(caPass);

// Step 6: Frost / Grain overlay shader
const FrostGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;

    // Hash noise
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Film grain
      float grain = hash(vUv * 500.0 + uTime * 100.0) - 0.5;
      color.rgb += grain * 0.06;

      // Frost vignette with noisy edges
      vec2 center = vUv - 0.5;
      float dist = length(center);
      float frostNoise = hash(vUv * 8.0 + uTime * 0.5) * 0.15;
      float vignette = smoothstep(0.4, 0.9, dist + frostNoise);

      // Blue-tinted darkening at corners
      vec3 frostTint = vec3(0.7, 0.8, 1.0);
      color.rgb = mix(color.rgb, color.rgb * frostTint * 0.3, vignette);

      // Subtle desaturation at frost edges
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(color.rgb, vec3(luma), vignette * 0.4);

      gl_FragColor = color;
    }
  `,
};

const frostGrainPass = new ShaderPass(FrostGrainShader);
composer.addPass(frostGrainPass);

// Output pass (tone mapping + color space)
const outputPass = new OutputPass();
composer.addPass(outputPass);

// ── Step 3: HDRI Environment Loading ────────────────────────────

const envLoader = new RGBELoader();
envLoader.load(
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    crystalMaterial.uniforms.uEnvMap.value = texture;
    crystalMaterial.uniforms.uEnvIntensity.value = 0.6;
  }
);

// ── Animation ───────────────────────────────────────────────────

function updateRotation(time) {
  crystal.rotation.x = Math.sin(time * 0.13) * 0.5 + Math.sin(time * 0.07) * 0.3;
  crystal.rotation.y = time * 0.08 + Math.sin(time * 0.11) * 0.4;
  crystal.rotation.z = Math.sin(time * 0.09) * 0.2 + Math.cos(time * 0.17) * 0.15;

  glowMesh.rotation.copy(crystal.rotation);
}

function updatePulse(time) {
  innerLight.intensity = 0.3 + 0.15 * Math.sin(time * 0.8) + 0.05 * Math.sin(time * 1.3);
}

function updateHover() {
  hoverCurrent += (hoverTarget - hoverCurrent) * 0.05;
  crystalMaterial.uniforms.uHover.value = hoverCurrent;
  glowMaterial.uniforms.uHover.value = hoverCurrent;
  auroraMat.uniforms.uHover.value = hoverCurrent;
}

// ── Fracture System ─────────────────────────────────────────────

function fractureCrystal() {
  crystal.visible = false;
  glowMesh.visible = false;
  auroraMesh.visible = false;

  const positions = crystalGeometry.attributes.position.array;
  const faceCount = positions.length / 9;

  for (let i = 0; i < faceCount; i++) {
    const verts = new Float32Array(9);
    for (let j = 0; j < 9; j++) {
      verts[j] = positions[i * 9 + j];
    }

    // Face centroid in local space
    const cx = (verts[0] + verts[3] + verts[6]) / 3;
    const cy = (verts[1] + verts[4] + verts[7]) / 3;
    const cz = (verts[2] + verts[5] + verts[8]) / 3;

    // Re-center vertices around centroid
    for (let v = 0; v < 3; v++) {
      verts[v * 3 + 0] -= cx;
      verts[v * 3 + 1] -= cy;
      verts[v * 3 + 2] -= cz;
    }

    const faceGeo = new THREE.BufferGeometry();
    faceGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    faceGeo.computeVertexNormals();

    const faceMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: crystalMaterial.uniforms.uTime.value },
        uHover: { value: 0 },
        uOpacity: { value: 1.0 },
        uEnvMap: { value: crystalMaterial.uniforms.uEnvMap.value },
        uEnvIntensity: { value: crystalMaterial.uniforms.uEnvIntensity.value },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const faceMesh = new THREE.Mesh(faceGeo, faceMat);

    // Transform centroid to world space using crystal's matrix
    const worldCentroid = new THREE.Vector3(cx, cy, cz);
    worldCentroid.applyMatrix4(crystal.matrixWorld);
    faceMesh.position.copy(worldCentroid);
    faceMesh.quaternion.copy(crystal.quaternion);

    // Animation data
    const dir = worldCentroid.clone().normalize();
    faceMesh.userData = {
      direction: dir,
      rotationAxis: new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize(),
      rotationSpeed: 0.5 + Math.random() * 2.0,
      delay: Math.random() * 0.3,
      speed: 0.8 + Math.random() * 0.6,
    };

    scene.add(faceMesh);
    fracturePieces.push(faceMesh);
  }

  // Central light burst
  burstLight = new THREE.PointLight(0xaabbff, 3.0, 10);
  burstLight.position.set(0, 0, 0);
  scene.add(burstLight);

  fractureStartTime = clock.getElapsedTime();
  fractured = true;

  // Step 7: Spike CA and bloom
  fractureFlashTime = fractureStartTime;

  // Step 7: Spawn particle burst
  spawnFractureParticles();
}

// ── Step 7: Fracture Particle Burst ─────────────────────────────

function spawnFractureParticles() {
  const count = 80;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;

    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
    const speed = 1.5 + Math.random() * 2.0;
    velocities.push(dir.multiplyScalar(speed));

    sizes[i] = 0.02 + Math.random() * 0.04;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uStartTime: { value: clock.getElapsedTime() },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      uniform float uTime;
      uniform float uStartTime;
      varying float vAlpha;

      void main() {
        float elapsed = uTime - uStartTime;
        vAlpha = max(0.0, 1.0 - elapsed / 2.5);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * 300.0 * vAlpha / -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;

      void main() {
        // Soft circle
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float soft = 1.0 - smoothstep(0.2, 0.5, d);

        // Icy white-blue
        vec3 color = vec3(0.7, 0.85, 1.0);
        gl_FragColor = vec4(color, soft * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  fractureParticles = { mesh: points, velocities, startTime: clock.getElapsedTime() };
}

function updateFractureParticles(time) {
  if (!fractureParticles) return;

  const elapsed = time - fractureParticles.startTime;
  if (elapsed > 2.5) {
    // Dispose particles
    scene.remove(fractureParticles.mesh);
    fractureParticles.mesh.geometry.dispose();
    fractureParticles.mesh.material.dispose();
    fractureParticles = null;
    return;
  }

  const positions = fractureParticles.mesh.geometry.attributes.position.array;
  const dt = 0.016;
  // Exponential slowdown
  const slowdown = Math.exp(-elapsed * 2.0);

  for (let i = 0; i < fractureParticles.velocities.length; i++) {
    const vel = fractureParticles.velocities[i];
    positions[i * 3] += vel.x * dt * slowdown;
    positions[i * 3 + 1] += vel.y * dt * slowdown;
    positions[i * 3 + 2] += vel.z * dt * slowdown;
  }

  fractureParticles.mesh.geometry.attributes.position.needsUpdate = true;
  fractureParticles.mesh.material.uniforms.uTime.value = time;
}

function updateFracture(time) {
  const elapsed = time - fractureStartTime;
  const duration = 2.5;

  for (const piece of fracturePieces) {
    const d = piece.userData;
    const t = Math.max(0, elapsed - d.delay) / (duration - d.delay);
    const progress = Math.min(t, 1.0);
    const eased = 1.0 - Math.pow(1.0 - progress, 3);

    // Drift outward
    piece.position.addScaledVector(d.direction, eased * d.speed * 0.016);

    // Spin
    piece.rotateOnAxis(d.rotationAxis, d.rotationSpeed * 0.008);

    // Fade
    piece.material.uniforms.uOpacity.value = Math.max(0, 1.0 - eased);
    piece.material.uniforms.uTime.value = time;
  }

  // Burst light decay
  if (burstLight) {
    const lp = elapsed / 0.8;
    if (lp < 1.0) {
      burstLight.intensity = 3.0 * (1.0 - lp * lp);
    } else {
      scene.remove(burstLight);
      burstLight.dispose && burstLight.dispose();
      burstLight = null;
    }
  }

  // Step 7: Decay CA + bloom flash
  if (fractureFlashTime >= 0) {
    const flashElapsed = time - fractureFlashTime;
    const flashDecay = Math.max(0, 1.0 - flashElapsed / 1.0);
    caPass.uniforms.uIntensity.value = 1.0 + 5.0 * flashDecay; // 6x at peak → 1x
    bloomPass.strength = 0.8 + 1.7 * flashDecay; // 2.5 at peak → 0.8
    if (flashElapsed > 1.0) {
      fractureFlashTime = -1;
      caPass.uniforms.uIntensity.value = 1.0;
      bloomPass.strength = 0.8;
    }
  }

  // Update particles
  updateFractureParticles(time);

  // After animation, clean up and show prompt
  if (elapsed > duration + 0.5) {
    for (const piece of fracturePieces) {
      scene.remove(piece);
      piece.geometry.dispose();
      piece.material.dispose();
    }
    fracturePieces.length = 0;
    innerLight.intensity = 0;
    showPrompt();
  }
}

// ── Prompt Reveal ───────────────────────────────────────────────

function showPrompt() {
  const overlay = document.getElementById('prompt-overlay');
  overlay.classList.remove('hidden');
  void overlay.offsetHeight;
  overlay.classList.add('visible');
  initCapsuleFlow();
}

// ── Utility ─────────────────────────────────────────────────────

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function scrollIntoView(el) {
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

// ── localStorage Capsule Store ──────────────────────────────────

const STORAGE_KEY = 'timecap_capsules';

function getStoredCapsules() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function storeCapsule(capsule) {
  const list = getStoredCapsules();
  list.push(capsule);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function removeCapsules(ids) {
  const list = getStoredCapsules().filter((c) => !ids.includes(c.id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function getDueCapsules() {
  const now = Date.now();
  return getStoredCapsules().filter((c) => c.deliverAt <= now);
}

function updatePendingBadge() {
  const pending = getStoredCapsules().filter((c) => c.deliverAt > Date.now());
  let badge = document.getElementById('pending-badge');
  if (pending.length === 0) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'pending-badge';
    document.body.appendChild(badge);
  }
  badge.textContent = `${pending.length} sealed`;
}

// ── Step Transitions ────────────────────────────────────────────

function transitionStep(from, to) {
  if (from) {
    from.classList.add('fading');
    setTimeout(() => {
      from.classList.add('hidden');
      from.classList.remove('fading');
      if (to) {
        to.classList.remove('hidden');
        to.style.opacity = '0';
        void to.offsetHeight;
        to.style.opacity = '1';
      }
    }, 800);
  } else if (to) {
    to.classList.remove('hidden');
    to.style.opacity = '0';
    void to.offsetHeight;
    to.style.opacity = '1';
  }
}

// ── Reveal Sequence (shared between 5s reveal & due return) ─────

function runRevealSequence(flowContainer, capsuleData, onComplete) {
  const answers = capsuleData.answers || (capsuleData.belief ? [capsuleData.belief] : []);
  const labels = answers.length === 1 && capsuleData.belief
    ? ['You believed']
    : REVEAL_LABELS.slice(0, answers.length);

  let step = 0;

  function revealNext() {
    if (step < answers.length) {
      const entry = document.createElement('div');
      entry.className = 'reveal-entry';
      entry.innerHTML = `
        <p class="reveal-label">${labels[step]}</p>
        <p class="reveal-text">\u201c${escapeHtml(answers[step])}\u201d</p>
      `;
      flowContainer.appendChild(entry);
      requestAnimationFrame(() => entry.classList.add('visible'));
      scrollIntoView(entry);
      step++;
      setTimeout(revealNext, 2500);
    } else {
      // All answers revealed — ask "What actually happened?"
      setTimeout(() => {
        showReturnPrompt(flowContainer, 'What actually happened?', (response) => {
          // Seal the response visually
          const sealed = document.createElement('div');
          sealed.className = 'sealed-entry';
          sealed.innerHTML = `
            <p class="sealed-q">What actually happened</p>
            <p class="sealed-a">\u201c${escapeHtml(response)}\u201d</p>
          `;
          flowContainer.appendChild(sealed);
          requestAnimationFrame(() => sealed.classList.add('visible'));

          // Store as seed for next cycle
          try {
            localStorage.setItem('timecap_seed', JSON.stringify({
              text: response,
              capsuleId: capsuleData.id,
              timestamp: Date.now(),
            }));
          } catch {}

          // Brief pause, then final prompt
          setTimeout(() => {
            showReturnPrompt(flowContainer, 'What did this surface that you weren\u2019t expecting?', (finalResponse) => {
              // Clear and show closing confirmation
              flowContainer.innerHTML = '';
              const closing = document.createElement('div');
              closing.className = 'closing-confirmation';
              closing.innerHTML = `<p class="closing-text">\u201c${escapeHtml(finalResponse)}\u201d</p>`;
              flowContainer.appendChild(closing);
              requestAnimationFrame(() => closing.classList.add('visible'));

              if (onComplete) {
                const btn = document.createElement('button');
                btn.className = 'again-btn';
                btn.textContent = 'Begin again';
                btn.style.opacity = '0';
                flowContainer.appendChild(btn);
                setTimeout(() => { btn.style.opacity = '1'; }, 800);
                btn.addEventListener('click', onComplete);
              }
            });
          }, 1500);
        });
      }, 1000);
    }
  }

  revealNext();
}

function showReturnPrompt(flowContainer, question, callback) {
  const wrapper = document.createElement('div');
  wrapper.className = 'return-prompt';
  wrapper.innerHTML = `
    <p class="prompt-text">${question}</p>
    <textarea class="return-input" rows="4"></textarea>
    <button class="seal-answer-btn hidden">Seal</button>
  `;
  flowContainer.appendChild(wrapper);
  requestAnimationFrame(() => wrapper.classList.add('visible'));
  scrollIntoView(wrapper);

  const textarea = wrapper.querySelector('textarea');
  const btn = wrapper.querySelector('button');

  setTimeout(() => textarea.focus(), 100);

  textarea.addEventListener('input', () => {
    if (textarea.value.trim()) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  });

  function submit() {
    const val = textarea.value.trim();
    if (!val) return;
    wrapper.classList.remove('visible');
    wrapper.style.opacity = '0';
    setTimeout(() => {
      wrapper.remove();
      callback(val);
    }, 800);
  }

  btn.addEventListener('click', submit);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (textarea.value.trim()) submit();
    }
  });
}

// ── Due Capsule Check (on page load) ────────────────────────────

function checkDueCapsules() {
  const due = getDueCapsules();
  if (due.length === 0) return;

  const overlay = document.getElementById('due-overlay');
  const flow = document.getElementById('due-flow');
  overlay.classList.remove('hidden');

  let index = 0;

  function processNext() {
    if (index >= due.length) {
      overlay.classList.add('fading');
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('fading');
      }, 1000);
      return;
    }

    const capsule = due[index];
    flow.innerHTML = '';

    // Show temporal context
    const meta = document.createElement('p');
    meta.className = 'due-meta';
    meta.textContent = `Sealed ${capsule.interval} ago`;
    flow.appendChild(meta);
    requestAnimationFrame(() => meta.classList.add('visible'));

    setTimeout(() => {
      runRevealSequence(flow, capsule, () => {
        removeCapsules([capsule.id]);
        index++;
        if (index < due.length) {
          flow.innerHTML = '';
          processNext();
        } else {
          overlay.classList.add('fading');
          setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('fading');
          }, 1000);
        }
      });
    }, 1500);
  }

  processNext();
}

// Run on page load
checkDueCapsules();
updatePendingBadge();

// ── Workshop Seal & Waiting Screen ──────────────────────────────

async function sealWorkshopResponse(answers) {
  const session = getWorkshopSession();
  const overlay = document.getElementById('prompt-overlay');
  const stepWaiting = document.getElementById('step-waiting');

  // Show waiting screen immediately
  overlay.classList.remove('hidden');
  void overlay.offsetHeight;
  overlay.classList.add('visible');
  stepWaiting.classList.remove('hidden');

  try {
    await fetch('/api/workshop-seal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: session.code,
        participantToken: session.participantToken,
        name: session.name,
        answers,
      }),
    });
  } catch {
    // Best-effort — waiting screen still shows even if network fails
  }

  // Poll for facilitator reveal
  startWaitingPoll(session.code);
}

function startWaitingPoll(code) {
  const waitingRevealed = document.getElementById('waiting-revealed');
  const waitingDots = document.getElementById('waiting-dots');

  let pollCount = 0;
  const MAX_POLLS = 600; // ~30 minutes at 3s intervals

  const interval = setInterval(async () => {
    pollCount++;
    if (pollCount > MAX_POLLS) {
      clearInterval(interval);
      return;
    }

    try {
      const res = await fetch(`/api/session-status?code=${encodeURIComponent(code)}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.status === 'revealed') {
        clearInterval(interval);
        waitingDots.style.opacity = '0';
        setTimeout(() => {
          waitingDots.style.display = 'none';
          waitingRevealed.classList.remove('hidden');
          void waitingRevealed.offsetHeight;
          waitingRevealed.style.opacity = '0';
          waitingRevealed.style.transition = 'opacity 1.5s ease';
          requestAnimationFrame(() => { waitingRevealed.style.opacity = '1'; });
        }, 400);
      }
    } catch {
      // Ignore polling errors
    }
  }, 3000);
}

// ── Capsule Flow (creation) ─────────────────────────────────────

function initCapsuleFlow() {
  const stepQuestions = document.getElementById('step-questions');
  const sealedContainer = document.getElementById('sealed-answers');
  const currentQuestion = document.getElementById('current-question');
  const questionText = document.getElementById('question-text');
  const textarea = document.getElementById('response-input');
  const sealBtn = document.getElementById('seal-answer-btn');
  const stepInterval = document.getElementById('step-interval');
  const stepDelivery = document.getElementById('step-delivery');
  const stepConfirm = document.getElementById('step-confirm');
  const stepReveal = document.getElementById('step-reveal');
  const contactInput = document.getElementById('contact-input');
  const sealCapsuleBtn = document.getElementById('seal-btn');
  const sealError = document.getElementById('seal-error');

  let questionIndex = 0;
  let answers = [];
  let selectedMethod = 'email';

  function showCurrentQuestion() {
    questionText.textContent = QUESTIONS[questionIndex];
    textarea.value = '';
    sealBtn.classList.add('hidden');
    currentQuestion.style.opacity = '0';
    void currentQuestion.offsetHeight;
    currentQuestion.style.opacity = '1';
    setTimeout(() => textarea.focus(), 100);
  }

  function sealAnswer() {
    const answer = textarea.value.trim();
    if (!answer) return;
    answers.push(answer);

    // Create sealed entry with glow → dim animation
    const entry = document.createElement('div');
    entry.className = 'sealed-entry sealing';
    entry.innerHTML = `
      <p class="sealed-q">${escapeHtml(QUESTIONS[questionIndex])}</p>
      <p class="sealed-a">\u201c${escapeHtml(answer)}\u201d</p>
    `;
    sealedContainer.appendChild(entry);
    requestAnimationFrame(() => {
      entry.classList.add('visible');
      setTimeout(() => {
        entry.classList.remove('sealing');
        entry.classList.add('sealed');
      }, 800);
    });

    questionIndex++;

    if (questionIndex < QUESTIONS.length) {
      currentQuestion.style.opacity = '0';
      setTimeout(() => showCurrentQuestion(), 1000);
    } else {
      // All three sealed
      currentQuestion.classList.add('hidden');
      setTimeout(() => {
        if (getMode() === 'workshop') {
          // Workshop mode: seal to server, show waiting screen
          transitionStep(stepQuestions, null);
          sealWorkshopResponse(answers);
        } else {
          // Individual mode: move to interval picker
          transitionStep(stepQuestions, stepInterval);
        }
      }, 1200);
    }
  }

  // Seal button
  sealBtn.addEventListener('click', sealAnswer);

  // Enter to seal
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (textarea.value.trim()) sealAnswer();
    }
  });

  // Show seal button when typing
  textarea.addEventListener('input', () => {
    if (textarea.value.trim().length > 0) {
      sealBtn.classList.remove('hidden');
    } else {
      sealBtn.classList.add('hidden');
    }
  });

  // Start first question
  showCurrentQuestion();

  // Reset everything for a new cycle
  function resetCreationFlow() {
    questionIndex = 0;
    answers = [];
    sealedContainer.innerHTML = '';
    currentQuestion.classList.remove('hidden');

    [stepInterval, stepDelivery, stepConfirm, stepReveal].forEach((s) => {
      s.classList.add('hidden');
      s.classList.remove('fading');
      s.style.opacity = '';
    });
    stepReveal.innerHTML = '';

    contactInput.value = '';
    sealCapsuleBtn.disabled = false;
    sealCapsuleBtn.textContent = 'Seal these thoughts';
    sealError.classList.add('hidden');
    selectedMethod = 'email';
    document.querySelectorAll('.method-toggle button').forEach((b) => {
      b.classList.toggle('active', b.dataset.method === 'email');
    });
    contactInput.type = 'email';
    contactInput.placeholder = 'your@email.com';

    stepQuestions.classList.remove('hidden');
    stepQuestions.style.opacity = '0';
    void stepQuestions.offsetHeight;
    stepQuestions.style.opacity = '1';
    showCurrentQuestion();
  }

  // "Begin again" buttons
  document.querySelectorAll('.again-btn').forEach((btn) => {
    btn.addEventListener('click', resetCreationFlow);
  });

  // Interval selection
  document.querySelectorAll('.interval-buttons button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seconds = parseInt(btn.dataset.seconds);
      const label = btn.dataset.label;

      stepDelivery.dataset.seconds = seconds;
      stepDelivery.dataset.label = label;
      transitionStep(stepInterval, stepDelivery);
    });
  });

  // Method toggle
  document.querySelectorAll('.method-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.method-toggle button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMethod = btn.dataset.method;

      if (selectedMethod === 'email') {
        contactInput.type = 'email';
        contactInput.placeholder = 'your@email.com';
        contactInput.autocomplete = 'email';
      } else {
        contactInput.type = 'tel';
        contactInput.placeholder = '+1 555 123 4567';
        contactInput.autocomplete = 'tel';
      }
    });
  });

  // Seal capsule
  sealCapsuleBtn.addEventListener('click', async () => {
    const contact = contactInput.value.trim();
    sealError.classList.add('hidden');

    if (!contact) {
      showError('Please enter your contact info.');
      return;
    }

    if (selectedMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      showError('Please enter a valid email address.');
      return;
    }

    if (selectedMethod === 'sms' && !/^\+?[\d\s\-()]{10,}$/.test(contact)) {
      showError('Please enter a valid phone number.');
      return;
    }

    const seconds = parseInt(stepDelivery.dataset.seconds);
    const label = stepDelivery.dataset.label;
    const deliverAt = Date.now() + seconds * 1000;

    sealCapsuleBtn.disabled = true;
    sealCapsuleBtn.textContent = 'Sealing...';

    const capsule = {
      id: crypto.randomUUID(),
      answers: [...answers],
      deliverAt,
      method: selectedMethod,
      contact,
      interval: label,
      createdAt: Date.now(),
    };

    let stored = false;
    let capsuleId = null;

    try {
      const res = await fetch('/api/capsules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capsule),
      });
      if (res.ok) {
        stored = true;
        const data = await res.json();
        capsuleId = data.id;
      }
    } catch {}

    if (!stored) {
      storeCapsule(capsule);
    }

    stepConfirm.querySelector('.confirm-text').textContent =
      `Your thoughts have been sealed. They will return to you in ${label}.`;
    transitionStep(stepDelivery, stepConfirm);
    updatePendingBadge();

    // For short intervals (5s), deliver immediately after a delay
    if (seconds <= 5 && stored && capsuleId) {
      setTimeout(async () => {
        try {
          await fetch('/api/deliver-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: capsuleId }),
          });
        } catch {}
      }, seconds * 1000);
    }
  });

  function showError(msg) {
    sealError.textContent = msg;
    sealError.classList.remove('hidden');
  }
}

// ── Event Handlers ──────────────────────────────────────────────

function onPointerMove(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (!fractured && crystal.visible) {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(crystal);
    hoverTarget = hits.length > 0 ? 1 : 0;
  }
}

function onPointerDown(e) {
  pointerDownPos = { x: e.clientX, y: e.clientY };
}

function onPointerUp(e) {
  if (!pointerDownPos || fractured) return;

  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 10) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(crystal);
    if (hits.length > 0) {
      fractureCrystal();
    }
  }

  pointerDownPos = null;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('resize', onResize);

// Prevent touch scroll on canvas
renderer.domElement.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

// ── Render Loop ─────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

  // Step 4: Smooth pointer lerp
  pointerSmooth.x += (pointer.x - pointerSmooth.x) * 0.03;
  pointerSmooth.y += (pointer.y - pointerSmooth.y) * 0.03;

  if (!fractured) {
    updateRotation(time);
    updatePulse(time);
    updateHover();
    crystalMaterial.uniforms.uTime.value = time;
    glowMaterial.uniforms.uTime.value = time;

    // Step 4: Camera parallax
    camera.position.x = pointerSmooth.x * 0.15;
    camera.position.y = pointerSmooth.y * 0.1;
    camera.lookAt(0, 0, 0);

    // Step 5: Update aurora
    auroraMat.uniforms.uTime.value = time;
    auroraMat.uniforms.uPointer.value.set(pointerSmooth.x, pointerSmooth.y);
  } else {
    // Lerp camera back to center during fracture
    camera.position.x += (0 - camera.position.x) * 0.03;
    camera.position.y += (0 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);

    if (fracturePieces.length > 0) {
      updateFracture(time);
    }
  }

  // Update post-processing time uniforms
  caPass.uniforms.uTime.value = time;
  frostGrainPass.uniforms.uTime.value = time;

  composer.render();
}

animate();
