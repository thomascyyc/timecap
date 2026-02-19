import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

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

// ── Crystal Shader ──────────────────────────────────────────────

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vViewDirection = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uHover;
  uniform float uOpacity;

  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;

  void main() {
    // Flat face normal from screen-space derivatives
    vec3 faceNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));

    // Fresnel rim glow
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

    // Combine: inner glow at face centers, color at edges, Fresnel rim
    float depth = 1.0 - fresnel;
    vec3 color = mix(faceColor * 0.4, innerGlow, depth * 0.6);
    color += fresnel * vec3(0.4, 0.5, 1.0) * (0.8 + uHover * 0.4);

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
}

// ── Fracture System ─────────────────────────────────────────────

function fractureCrystal() {
  crystal.visible = false;
  glowMesh.visible = false;

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

// ── Due Capsule Check (on page load) ────────────────────────────

function checkDueCapsules() {
  const due = getDueCapsules();
  if (due.length === 0) return;

  const overlay = document.getElementById('due-overlay');
  const container = document.getElementById('due-capsules');
  const dismissBtn = document.getElementById('due-dismiss');

  container.innerHTML = '';
  for (const cap of due) {
    const card = document.createElement('div');
    card.className = 'due-card';
    card.innerHTML = `
      <p class="due-meta">Sealed ${cap.interval} ago</p>
      <p class="due-belief">&ldquo;${escapeHtml(cap.belief)}&rdquo;</p>
      <p class="due-contact">${escapeHtml(cap.method)}: ${escapeHtml(cap.contact)}</p>
    `;
    container.appendChild(card);
  }

  overlay.classList.remove('hidden');

  dismissBtn.addEventListener('click', () => {
    removeCapsules(due.map((c) => c.id));
    overlay.classList.add('fading');
    setTimeout(() => overlay.classList.add('hidden'), 1000);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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

// Run on page load
checkDueCapsules();
updatePendingBadge();

// ── Capsule Flow ────────────────────────────────────────────────

function initCapsuleFlow() {
  const textarea = document.getElementById('response-input');
  const continueBtn = document.getElementById('continue-btn');
  const stepPrompt = document.getElementById('step-prompt');
  const stepInterval = document.getElementById('step-interval');
  const stepDelivery = document.getElementById('step-delivery');
  const stepConfirm = document.getElementById('step-confirm');
  const stepReveal = document.getElementById('step-reveal');
  const contactInput = document.getElementById('contact-input');
  const sealBtn = document.getElementById('seal-btn');
  const sealError = document.getElementById('seal-error');

  let belief = '';
  let selectedMethod = 'email';

  function resetToPrompt() {
    // Hide all steps, reset form, show prompt step
    [stepInterval, stepDelivery, stepConfirm, stepReveal].forEach((s) => {
      s.classList.add('hidden');
      s.classList.remove('fading');
      s.style.opacity = '';
    });
    textarea.value = '';
    contactInput.value = '';
    continueBtn.classList.add('hidden');
    sealBtn.disabled = false;
    sealBtn.textContent = 'Seal this belief';
    sealError.classList.add('hidden');
    belief = '';
    selectedMethod = 'email';
    document.querySelectorAll('.method-toggle button').forEach((b) => {
      b.classList.toggle('active', b.dataset.method === 'email');
    });
    contactInput.type = 'email';
    contactInput.placeholder = 'your@email.com';

    stepPrompt.classList.remove('hidden');
    stepPrompt.style.opacity = '0';
    void stepPrompt.offsetHeight;
    stepPrompt.style.opacity = '1';
    textarea.focus();
  }

  // "Seal another" buttons
  document.querySelectorAll('.again-btn').forEach((btn) => {
    btn.addEventListener('click', resetToPrompt);
  });

  // Show continue button when user types
  textarea.addEventListener('input', () => {
    if (textarea.value.trim().length > 0) {
      continueBtn.classList.remove('hidden');
    } else {
      continueBtn.classList.add('hidden');
    }
  });

  // Continue: capture belief, show interval picker
  function onContinue() {
    belief = textarea.value.trim();
    if (!belief) return;
    transitionStep(stepPrompt, stepInterval);
  }

  continueBtn.addEventListener('click', onContinue);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (textarea.value.trim()) onContinue();
    }
  });

  // Interval selection
  document.querySelectorAll('.interval-buttons button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seconds = parseInt(btn.dataset.seconds);
      const label = btn.dataset.label;

      if (seconds === 5) {
        transitionStep(stepInterval, null);
        setTimeout(() => {
          stepReveal.querySelector('.reveal-text').textContent = belief;
          stepReveal.classList.remove('hidden');
          stepReveal.style.opacity = '0';
          void stepReveal.offsetHeight;
          stepReveal.style.opacity = '1';
        }, 5000);
      } else {
        stepDelivery.dataset.seconds = seconds;
        stepDelivery.dataset.label = label;
        transitionStep(stepInterval, stepDelivery);
      }
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

  // Seal
  sealBtn.addEventListener('click', async () => {
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

    sealBtn.disabled = true;
    sealBtn.textContent = 'Sealing...';

    const capsule = {
      id: crypto.randomUUID(),
      belief,
      deliverAt,
      method: selectedMethod,
      contact,
      interval: label,
      createdAt: Date.now(),
    };

    let stored = false;

    // Try server first, fall back to localStorage
    try {
      const res = await fetch('/api/capsules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capsule),
      });

      if (res.ok) {
        stored = true;
      }
    } catch {
      // Network error — expected on local dev
    }

    if (!stored) {
      // localStorage fallback
      storeCapsule(capsule);
      stored = true;
    }

    stepConfirm.querySelector('.confirm-text').textContent =
      `Your belief has been sealed. It will return to you in ${label}.`;
    transitionStep(stepDelivery, stepConfirm);
    updatePendingBadge();
  });

  function showError(msg) {
    sealError.textContent = msg;
    sealError.classList.remove('hidden');
  }

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

  if (!fractured) {
    updateRotation(time);
    updatePulse(time);
    updateHover();
    crystalMaterial.uniforms.uTime.value = time;
    glowMaterial.uniforms.uTime.value = time;
  } else if (fracturePieces.length > 0) {
    updateFracture(time);
  }

  renderer.render(scene, camera);
}

animate();
