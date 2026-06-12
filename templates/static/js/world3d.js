/**
 * world3d.js — CivSim 3D Living World Engine
 *
 * Transforms the flat SVG map into a living animated 3D war simulation.
 * Inspired by: Clash of Clans · Rise of Kingdoms · Civilization VI · Total War
 *
 * Architecture:
 *   - Three.js r160 via unpkg ESM
 *   - InstancedMesh for troops (performance: 3 draw calls per nation)
 *   - Vertex-animated flag waving
 *   - GSAP-tweened war / alliance / trade animations
 *   - Custom RTS camera (orbit, pan, zoom)
 *   - Point-light campfire glow with flicker
 *   - Particle systems: smoke, battle explosions, gold bursts
 */

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────

const NATION_CFG = {
  Ironmark: {
    color:     0xc0392b, colorStr: '#c0392b',
    troopColor:0x922b21, helmColor:0x808080,
    pos:       new THREE.Vector3(-4.8, 0, -2.5),
    crest:     '⚔',  label: 'IRONMARK',
    troopType: 'infantry',
  },
  Aurentum: {
    color:     0xf39c12, colorStr: '#f39c12',
    troopColor:0xb7770d, helmColor:0xf4d03f,
    pos:       new THREE.Vector3(-0.6, 0, -2.9),
    crest:     '♛',  label: 'AURENTUM',
    troopType: 'merchants',
  },
  Solenne: {
    color:     0x8e44ad, colorStr: '#8e44ad',
    troopColor:0x6c3483, helmColor:0xd7bde2,
    pos:       new THREE.Vector3(3.5, 0, -2.25),
    crest:     '✦',  label: 'SOLENNE',
    troopType: 'crusaders',
  },
  Valdris: {
    color:     0x2980b9, colorStr: '#2980b9',
    troopColor:0x1a5276, helmColor:0x5dade2,
    pos:       new THREE.Vector3(-4.3, 0, 1.8),
    crest:     '⚓',  label: 'VALDRIS',
    troopType: 'marines',
  },
  Kethara: {
    color:     0x16a085, colorStr: '#16a085',
    troopColor:0x0e6655, helmColor:0x76d7c4,
    pos:       new THREE.Vector3(2.2, 0, 2.1),
    crest:     '✿',  label: 'KETHARA',
    troopType: 'elite',
  },
};

const MAX_TROOPS    = 25; // per nation instanced max
const TROOP_ARMY_DIV = 20; // army / this = visible troop count

// ─────────────────────────────────────────────────────────────────
// MAIN CLASS
// ─────────────────────────────────────────────────────────────────

export class CivWorld3D {
  constructor(container, callbacks = {}) {
    this.container  = container;
    this.cb         = callbacks;  // { onSelect(name), getState() }

    // Three.js core
    this.scene    = null;
    this.camera   = null;
    this.renderer = null;

    // State
    this.nations  = {};
    this.selected = null;

    // Scene collections
    this.cityGroups   = {};   // { [name]: THREE.Group }
    this.flags        = [];   // all flag meshes for wave animation
    this.troopSystems = {};   // { [name]: TroopSystem }
    this.smokeList    = [];   // campfire smoke Points
    this.tempAnims    = [];   // [ { obj, update(delta)->bool } ]
    this.clickTargets = [];   // [ { mesh, nation } ]
    this.glowLights   = {};   // { [name]: PointLight }
    this.zonesMesh    = {};   // { [name]: Mesh } — coloured territory zones

    // Camera control
    this.camTarget   = new THREE.Vector3(0, 0, 0);
    this.camDist     = 14;
    this.camAz       = 0.3;        // azimuth (horizontal angle)
    this.camEl       = 0.7;        // elevation (vertical angle)
    this.isDragging  = false;
    this.isRightBtn  = false;
    this.lastMx      = 0;
    this.lastMy      = 0;
    this.dragStartX  = 0;
    this.dragStartY  = 0;
    this.wasDragging = false;
    this.shakeData   = null;

    // Raycasting
    this.raycaster   = new THREE.Raycaster();
    this.mouse       = new THREE.Vector2();
    this.hovered     = null;

    // Time
    this.clock       = new THREE.Clock();
    this.time        = 0;

    // Reusable transform objects (avoid GC pressure)
    this._m4   = new THREE.Matrix4();
    this._v3   = new THREE.Vector3();
    this._q    = new THREE.Quaternion();
    this._s    = new THREE.Vector3(1, 1, 1);
    this._up   = new THREE.Vector3(0, 1, 0);
    this._zero = new THREE.Vector3(0, 0, 0);

    // Bind methods
    this._loop       = this._loop.bind(this);
    this._onResize   = this._onResize.bind(this);
    this._onClick    = this._onClick.bind(this);
    this._onMDown    = this._onMDown.bind(this);
    this._onMMove    = this._onMMove.bind(this);
    this._onMUp      = this._onMUp.bind(this);
    this._onWheel    = this._onWheel.bind(this);
    this._onCMenu    = this._onCMenu.bind(this);
  }

  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════

  init() {
    this._setupRenderer();
    this._setupScene();
    this._setupLights();
    this._setupCamera();
    this._buildWorld();
    this._buildAllCities();
    this._initAllTroops();
    this._initSmoke();
    this._setupInput();
    this._loop();
    window.civWorld = this;
    console.log('[CivSim 3D] ✓ World online');
  }

  // ══════════════════════════════════════════════════════════════
  // RENDERER
  // ══════════════════════════════════════════════════════════════

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setClearColor(0x020810, 1);

    const c = this.renderer.domElement;
    c.id = 'world3d-canvas';
    c.style.cssText = 'position:absolute;inset:0;width:100%!important;height:100%!important;z-index:1;cursor:default;';
    this.container.appendChild(c);

    this._onResize();
    window.addEventListener('resize', this._onResize);
  }

  _onResize() {
    const w = this.container.clientWidth  || 800;
    const h = this.container.clientHeight || 600;
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.renderer.setSize(w, h, false);
  }

  // ══════════════════════════════════════════════════════════════
  // SCENE + LIGHTS
  // ══════════════════════════════════════════════════════════════

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x020810, 0.025);
    this.scene.background = new THREE.Color(0x050d1a);
  }

  _setupLights() {
    // Soft ambient
    this.scene.add(new THREE.AmbientLight(0x203050, 1.0));

    // Sun — warm, casts shadows
    const sun = new THREE.DirectionalLight(0xfff4d6, 2.4);
    sun.position.set(9, 16, 7);
    sun.castShadow = true;
    sun.shadow.camera.near   = 0.5;
    sun.shadow.camera.far    = 55;
    sun.shadow.camera.left   = -13; sun.shadow.camera.right  = 13;
    sun.shadow.camera.bottom = -13; sun.shadow.camera.top    = 13;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);

    // Cool fill from opposite side
    const fill = new THREE.DirectionalLight(0x4060a0, 0.55);
    fill.position.set(-7, 10, -9);
    this.scene.add(fill);

    // Hemisphere sky/ground
    this.scene.add(new THREE.HemisphereLight(0x1a3560, 0x2a1a08, 0.55));
  }

  // ══════════════════════════════════════════════════════════════
  // CAMERA
  // ══════════════════════════════════════════════════════════════

  _setupCamera() {
    const w = this.container.clientWidth  || 800;
    const h = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    this._syncCamera();
  }

  _syncCamera() {
    const x = this.camTarget.x + this.camDist * Math.sin(this.camAz) * Math.cos(this.camEl);
    const y = this.camTarget.y + this.camDist * Math.sin(this.camEl);
    const z = this.camTarget.z + this.camDist * Math.cos(this.camAz) * Math.cos(this.camEl);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.camTarget);
  }

  // ══════════════════════════════════════════════════════════════
  // WORLD TERRAIN
  // ══════════════════════════════════════════════════════════════

  _buildWorld() {
    this._buildOcean();
    this._buildIslands();
    this._buildTerritoryZones();
    this._buildBorderMountains();
    this._buildScatteredTrees();
  }

  _buildOcean() {
    const geo = new THREE.PlaneGeometry(30, 30);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x03101e, roughness: 0.12, metalness: 0.35,
    });
    const ocean = new THREE.Mesh(geo, mat);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.06;
    ocean.receiveShadow = true;
    this.scene.add(ocean);

    // Subtle ocean glow at center (inner sea)
    const cGeo = new THREE.CircleGeometry(3.0, 32);
    const cMat = new THREE.MeshBasicMaterial({ color: 0x071525, transparent: true, opacity: 0.7 });
    const cen  = new THREE.Mesh(cGeo, cMat);
    cen.rotation.x = -Math.PI / 2;
    cen.position.set(0, -0.04, 0);
    this.scene.add(cen);

    // Animated ocean point light
    const oceanLight = new THREE.PointLight(0x1a3a5c, 1.2, 8, 1.5);
    oceanLight.position.set(0, 0.5, 0);
    this.scene.add(oceanLight);
    this._oceanLight = oceanLight;
  }

  _buildIslands() {
    Object.entries(NATION_CFG).forEach(([name, cfg]) => {
      // Land island per nation
      const seg = 18;
      const geo = new THREE.CircleGeometry(3.0, seg);
      const pos = geo.attributes.position;

      // Deform outer vertices for organic shape
      for (let i = 1; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const r = Math.sqrt(x * x + z * z);
        const norm = r / 3.0;
        const noiseY = 0.03 * (1 - norm * norm * norm * norm);
        const noiseR = 1.0 + (Math.sin(i * 1.7) * 0.12 + Math.cos(i * 2.3) * 0.08);
        pos.setX(i, x * noiseR);
        pos.setZ(i, z * noiseR);
        pos.setY(i, noiseY);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({ color: 0x2c4a1c, roughness: 0.92, metalness: 0.0 });
      const island = new THREE.Mesh(geo, mat);
      island.rotation.x = -Math.PI / 2;
      island.position.set(cfg.pos.x, 0.01, cfg.pos.z);
      island.receiveShadow = true;
      this.scene.add(island);

      // Shoreline ring (lighter sand color)
      const sGeo = new THREE.RingGeometry(2.85, 3.1, seg);
      const sMat = new THREE.MeshBasicMaterial({ color: 0x4a3a1a, transparent: true, opacity: 0.65, side: THREE.DoubleSide });
      const shore = new THREE.Mesh(sGeo, sMat);
      shore.rotation.x = -Math.PI / 2;
      shore.position.set(cfg.pos.x, 0.02, cfg.pos.z);
      this.scene.add(shore);
    });
  }

  _buildTerritoryZones() {
    Object.entries(NATION_CFG).forEach(([name, cfg]) => {
      const geo = new THREE.CircleGeometry(2.8, 24);
      const mat = new THREE.MeshBasicMaterial({
        color: cfg.color, transparent: true, opacity: 0.13,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const zone = new THREE.Mesh(geo, mat);
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(cfg.pos.x, 0.06, cfg.pos.z);
      zone.name = `zone-${name}`;
      zone.renderOrder = 1;
      this.scene.add(zone);
      this.zonesMesh[name] = zone;

      // Invisible hit plane for raycasting (larger for ease of click)
      const hGeo = new THREE.CircleGeometry(2.6, 16);
      const hMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
      const hit  = new THREE.Mesh(hGeo, hMat);
      hit.rotation.x = -Math.PI / 2;
      hit.position.set(cfg.pos.x, 0.08, cfg.pos.z);
      hit.name = `hit-${name}`;
      this.scene.add(hit);
      this.clickTargets.push({ mesh: hit, nation: name });
    });
  }

  _buildBorderMountains() {
    const positions = [
      [-7.5, -4.5], [7.5, -4.5], [-7.5, 4.5], [7.5, 4.5],
      [-7,   0],    [7,   0],    [0,   -7.5],  [0,   7.5],
      [-5.5, -6.5], [5.5, -6.5], [-5.5, 6.5],  [5.5, 6.5],
      [-3,   -7],   [3,   -7],   [-3,   7],     [3,   7],
    ];

    positions.forEach(([bx, bz]) => {
      const count = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < count; k++) {
        const x = bx + (Math.random() - 0.5) * 1.4;
        const z = bz + (Math.random() - 0.5) * 1.4;
        const h = 0.7 + Math.random() * 1.5;
        const r = 0.35 + Math.random() * 0.55;

        const mGeo = new THREE.ConeGeometry(r, h, 6);
        const mMat = new THREE.MeshStandardMaterial({ color: 0x3a2e20, roughness: 0.92 });
        const mtn  = new THREE.Mesh(mGeo, mMat);
        mtn.position.set(x, h * 0.5, z);
        mtn.castShadow = true;
        this.scene.add(mtn);

        // Snow cap
        const sGeo = new THREE.ConeGeometry(r * 0.42, h * 0.32, 6);
        const sMat = new THREE.MeshStandardMaterial({ color: 0xdce8f0, roughness: 1.0 });
        const snow = new THREE.Mesh(sGeo, sMat);
        snow.position.set(x, h * 0.85, z);
        this.scene.add(snow);
      }
    });
  }

  _buildScatteredTrees() {
    const allPos = [];
    Object.values(NATION_CFG).forEach(cfg => {
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r     = 1.9 + Math.random() * 1.8;
        allPos.push({ x: cfg.pos.x + Math.cos(angle) * r, z: cfg.pos.z + Math.sin(angle) * r });
      }
    });

    allPos.forEach(({ x, z }) => {
      const h = 0.45 + Math.random() * 0.65;
      const r = 0.06 + Math.random() * 0.03;

      const trGeo = new THREE.CylinderGeometry(r * 0.5, r, h * 0.4, 5);
      const trMat = new THREE.MeshStandardMaterial({ color: 0x4a2e10, roughness: 1 });
      const trunk = new THREE.Mesh(trGeo, trMat);
      trunk.position.set(x, h * 0.2, z);
      trunk.castShadow = true;
      this.scene.add(trunk);

      const lGeo = new THREE.ConeGeometry(0.22 + Math.random() * 0.1, h, 6);
      const lMat = new THREE.MeshStandardMaterial({ color: 0x1a4d16, roughness: 0.88 });
      const lvs  = new THREE.Mesh(lGeo, lMat);
      lvs.position.set(x, h * 0.65, z);
      lvs.castShadow = true;
      this.scene.add(lvs);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // CITY CONSTRUCTION
  // ══════════════════════════════════════════════════════════════

  _buildAllCities() {
    Object.entries(NATION_CFG).forEach(([name, cfg]) => {
      const group = new THREE.Group();
      group.position.copy(cfg.pos);
      group.name = `city-${name}`;

      this._buildCastle(group, cfg.color);
      this._buildVillages(group, cfg.color);
      this._buildWatchtowers(group, cfg.color);
      this._buildCityRoads(group);
      this._buildMainFlag(group, cfg.color, name);

      // Campfire glow point light
      const glow = new THREE.PointLight(new THREE.Color(cfg.color), 0.9, 4.8, 2.0);
      glow.position.set(0, 1.2, 0);
      group.add(glow);
      this.glowLights[name] = glow;

      this.scene.add(group);
      this.cityGroups[name] = group;

      // City-level raycasting (invisible hit plane)
      const hitGeo = new THREE.CircleGeometry(1.5, 12);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
      const hit    = new THREE.Mesh(hitGeo, hitMat);
      hit.rotation.x = -Math.PI / 2;
      hit.position.set(cfg.pos.x, 0.09, cfg.pos.z);
      hit.name = `city-hit-${name}`;
      this.scene.add(hit);
      this.clickTargets.push({ mesh: hit, nation: name });
    });
  }

  _buildCastle(g, color) {
    const col = new THREE.Color(color);

    // Stone platform
    const plat = this._box(1.6, 0.14, 1.6, 0x504030, g);
    plat.position.set(0, 0.07, 0);
    plat.receiveShadow = true;

    // Main keep
    const keep = this._box(0.72, 1.5, 0.72, 0x3a3028, g);
    keep.position.set(0, 0.82, 0);
    keep.castShadow = true;

    // Keep top (nation-colored)
    const top = this._box(0.85, 0.14, 0.85, col.clone().multiplyScalar(0.65), g);
    top.position.set(0, 1.57, 0);

    // 4 corner turrets
    [[-0.52, -0.52], [0.52, -0.52], [-0.52, 0.52], [0.52, 0.52]].forEach(([tx, tz]) => {
      const tGeo = new THREE.CylinderGeometry(0.17, 0.19, 1.3, 8);
      const tMat = new THREE.MeshStandardMaterial({ color: 0x443830, roughness: 0.88 });
      const twr  = new THREE.Mesh(tGeo, tMat);
      twr.position.set(tx, 0.72, tz);
      twr.castShadow = true;
      g.add(twr);

      // Cone cap (nation-colored)
      const cGeo = new THREE.ConeGeometry(0.20, 0.32, 8);
      const cMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.75), roughness: 0.7 });
      const cap  = new THREE.Mesh(cGeo, cMat);
      cap.position.set(tx, 1.53, tz);
      cap.castShadow = true;
      g.add(cap);
    });

    // Curtain walls
    [
      { p: [0, 0.37,  0.52], s: [1.1, 0.76, 0.1] },
      { p: [0, 0.37, -0.52], s: [1.1, 0.76, 0.1] },
      { p: [ 0.52, 0.37, 0], s: [0.1, 0.76, 1.1] },
      { p: [-0.52, 0.37, 0], s: [0.1, 0.76, 1.1] },
    ].forEach(({ p, s }) => {
      const w = this._box(s[0], s[1], s[2], 0x484038, g);
      w.position.set(p[0], p[1], p[2]);
      w.castShadow = true; w.receiveShadow = true;
    });

    // Gate (dark recessed opening)
    const gate = this._box(0.28, 0.42, 0.14, 0x160f08, g);
    gate.position.set(0, 0.21, 0.52);
  }

  _buildVillages(g, color) {
    const col = new THREE.Color(color);
    [[-1.1, 0.4], [-0.9, -1.05], [1.05, -0.85], [1.2, 0.55]].forEach(([ox, oz]) => {
      const house = this._box(0.34, 0.3, 0.34, 0x5c4c38, g);
      house.position.set(ox, 0.15, oz);
      house.castShadow = true;

      const rGeo = new THREE.ConeGeometry(0.27, 0.24, 4);
      const rMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.45).addScalar(0.04), roughness: 0.9 });
      const roof = new THREE.Mesh(rGeo, rMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(ox, 0.42, oz);
      roof.castShadow = true;
      g.add(roof);
    });
  }

  _buildWatchtowers(g, color) {
    const col = new THREE.Color(color);
    [[-1.55, 1.55], [1.55, 1.55]].forEach(([ox, oz], i) => {
      const tGeo = new THREE.CylinderGeometry(0.14, 0.17, 1.1, 7);
      const tMat = new THREE.MeshStandardMaterial({ color: 0x403528, roughness: 0.9 });
      const twr  = new THREE.Mesh(tGeo, tMat);
      twr.position.set(ox, 0.55, oz);
      twr.castShadow = true;
      g.add(twr);

      const pGeo = new THREE.CylinderGeometry(0.22, 0.15, 0.12, 7);
      const pMat = new THREE.MeshStandardMaterial({ color: 0x484038 });
      const plat = new THREE.Mesh(pGeo, pMat);
      plat.position.set(ox, 1.16, oz);
      g.add(plat);

      // Small watchtower flag
      this._addFlag(g, ox, 1.28, oz, color, 0.38, 0.25);
    });
  }

  _buildCityRoads(g) {
    [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].forEach(angle => {
      const rGeo = new THREE.PlaneGeometry(0.14, 1.6);
      const rMat = new THREE.MeshStandardMaterial({ color: 0x3e3020, roughness: 1.0 });
      const road = new THREE.Mesh(rGeo, rMat);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = angle;
      road.position.set(
        Math.cos(angle + Math.PI * 0.5) * 0.8,
        0.015,
        Math.sin(angle + Math.PI * 0.5) * 0.8,
      );
      road.receiveShadow = true;
      g.add(road);
    });
  }

  _buildMainFlag(g, color, name) {
    this._addFlag(g, 0, 1.64, 0, color, 0.7, 0.45, name);
  }

  _addFlag(g, x, y, z, color, fw, fh, nationName = '') {
    // Pole
    const pGeo = new THREE.CylinderGeometry(0.024, 0.028, 1.0, 6);
    const pMat = new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: 0.55, roughness: 0.45 });
    const pole = new THREE.Mesh(pGeo, pMat);
    pole.position.set(x, y + 0.5, z);
    g.add(pole);

    // Flag cloth (segmented plane for wave animation)
    const segW = 7, segH = 4;
    const fGeo = new THREE.PlaneGeometry(fw, fh, segW, segH);

    // Store original Y positions (Z in world space once placed)
    const posAttr = fGeo.attributes.position;
    const origZ   = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) origZ[i] = posAttr.getZ(i);
    fGeo._origZ = origZ;

    const fMat = new THREE.MeshStandardMaterial({
      color:    color, side: THREE.DoubleSide, roughness: 0.85,
    });
    const flag = new THREE.Mesh(fGeo, fMat);
    // Place flag: pivot at left edge (pole side), extend right
    flag.position.set(x + fw * 0.5, y + 0.88, z);
    flag.userData.fw = fw;
    flag.castShadow = true;
    g.add(flag);
    this.flags.push(flag);
  }

  // Helper
  _box(w, h, d, color, parent) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: color instanceof THREE.Color ? color : new THREE.Color(color),
      roughness: 0.88, metalness: 0.05,
    });
    const m = new THREE.Mesh(geo, mat);
    parent?.add(m);
    return m;
  }

  // ══════════════════════════════════════════════════════════════
  // TROOP INSTANCED SYSTEM
  // ══════════════════════════════════════════════════════════════

  _initAllTroops() {
    Object.entries(NATION_CFG).forEach(([name, cfg]) => {
      this._createTroopSystem(name, cfg, 10);
    });
  }

  _createTroopSystem(name, cfg, initialArmy) {
    const count = this._armyToCount(initialArmy);

    // Shared geometries
    const bodyGeo = new THREE.CylinderGeometry(0.068, 0.09,  0.28, 6);
    const headGeo = new THREE.SphereGeometry(0.079, 6, 5);
    const wepGeo  = new THREE.BoxGeometry(0.015, 0.36, 0.015);

    const bodyMat = new THREE.MeshStandardMaterial({ color: cfg.troopColor, roughness: 0.75, metalness: 0.2 });
    const headMat = new THREE.MeshStandardMaterial({ color: cfg.helmColor,  roughness: 0.55, metalness: 0.4 });
    const wepMat  = new THREE.MeshStandardMaterial({ color: 0xb8b0a0,       roughness: 0.3,  metalness: 0.75 });

    const bodies  = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX_TROOPS);
    const heads   = new THREE.InstancedMesh(headGeo, headMat, MAX_TROOPS);
    const weapons = new THREE.InstancedMesh(wepGeo,  wepMat,  MAX_TROOPS);

    bodies.castShadow  = true;
    heads.castShadow   = true;

    // Zero-scale all instances
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_TROOPS; i++) {
      bodies.setMatrixAt(i, zero);
      heads.setMatrixAt(i, zero);
      weapons.setMatrixAt(i, zero);
    }
    bodies.instanceMatrix.needsUpdate  = true;
    heads.instanceMatrix.needsUpdate   = true;
    weapons.instanceMatrix.needsUpdate = true;

    this.scene.add(bodies);
    this.scene.add(heads);
    this.scene.add(weapons);

    // Per-troop data
    const troopData = Array.from({ length: MAX_TROOPS }, (_, i) => ({
      angle:    (i / MAX_TROOPS) * Math.PI * 2 + Math.random() * 0.4,
      speed:    (0.22 + Math.random() * 0.18) * (i % 3 === 0 ? -1 : 1),
      radius:   0.85 + Math.floor(i / 8) * 0.5 + Math.random() * 0.28,
      bobPhase: Math.random() * Math.PI * 2,
      active:   i < count,
    }));

    this.troopSystems[name] = {
      bodies, heads, weapons, troopData, count,
      capital: cfg.pos.clone(),
    };
  }

  _armyToCount(army) {
    return Math.max(2, Math.min(MAX_TROOPS, Math.round((army || 10) / TROOP_ARMY_DIV)));
  }

  updateTroopCount(name, army) {
    const sys = this.troopSystems[name];
    if (!sys) return;
    sys.count = this._armyToCount(army);
    sys.troopData.forEach((t, i) => { t.active = i < sys.count; });
  }

  // ══════════════════════════════════════════════════════════════
  // CAMPFIRE SMOKE
  // ══════════════════════════════════════════════════════════════

  _initSmoke() {
    Object.entries(NATION_CFG).forEach(([name, cfg]) => {
      // Smoke rises from a spot near the city center
      const base = cfg.pos.clone().add(new THREE.Vector3(0.28, 0, 0.28));
      const smoke = this._makeSmokeSystem(base);
      smoke.userData.nation = name;
      this.smokeList.push(smoke);
    });
  }

  _makeSmokeSystem(base) {
    const N = 22;
    const geo = new THREE.BufferGeometry();
    const pos  = new Float32Array(N * 3);
    const prog = new Float32Array(N);
    const ox   = new Float32Array(N);
    const oz   = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      pos[i*3]   = base.x; pos[i*3+1] = base.y + 0.05; pos[i*3+2] = base.z;
      prog[i]    = Math.random();
      ox[i]      = (Math.random() - 0.5) * 0.32;
      oz[i]      = (Math.random() - 0.5) * 0.32;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xaaaaaa, size: 0.2, transparent: true, opacity: 0.3,
      sizeAttenuation: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.userData = { base, prog, ox, oz, N };
    pts.renderOrder = 2;
    this.scene.add(pts);
    return pts;
  }

  // ══════════════════════════════════════════════════════════════
  // PUBLIC STATE UPDATES (called by renderer.js hooks)
  // ══════════════════════════════════════════════════════════════

  updateNations(nations) {
    this.nations = nations;

    Object.entries(nations).forEach(([name, n]) => {
      this.updateTroopCount(name, n.army || 0);

      const zone = this.zonesMesh[name];
      const city = this.cityGroups[name];
      const glow = this.glowLights[name];

      if (n.eliminated) {
        if (zone) { zone.material.color.set(0x333333); zone.material.opacity = 0.04; }
        if (glow) { glow.intensity = 0; }
        // Dim city — only once (check flag)
        if (city && !city.userData.dimmed) {
          city.userData.dimmed = true;
          city.traverse(obj => {
            if (obj.isMesh && obj.material && !obj.material._dimmed) {
              obj.material = obj.material.clone();
              obj.material.color.multiplyScalar(0.22);
              obj.material._dimmed = true;
            }
          });
        }
      } else {
        if (zone) { zone.material.color.set(NATION_CFG[name].color); zone.material.opacity = 0.13; }
      }
    });
  }

  onEvent(event) {
    const { action_type, actor, target } = event;
    const t = target || this._nearestEnemy(actor);

    switch (action_type) {
      case 'attack':
      case 'declare_war': this.animateWar(actor, t);      break;
      case 'alliance':    this.animateAlliance(actor, t); break;
      case 'trade':       this.animateTrade(actor, t);    break;
      case 'develop':     this.animateDevelop(actor);     break;
    }
  }

  flashNation(name, type) {
    const zone = this.zonesMesh[name];
    if (!zone || this.nations[name]?.eliminated) return;
    const origColor = NATION_CFG[name]?.color || 0xffffff;
    zone.material.color.set(type === 'bonus' ? 0xf4d03f : 0xff2200);
    zone.material.opacity = 0.55;
    setTimeout(() => {
      zone.material.color.set(origColor);
      zone.material.opacity = 0.13;
    }, 650);
  }

  selectNation(name) {
    if (!NATION_CFG[name]) return;
    this.selected = name;
    this._removeSelectionRing();
    this._addSelectionRing(NATION_CFG[name].pos, NATION_CFG[name].color);

    // Smooth camera pan toward capital
    const cfg = NATION_CFG[name];
    if (window.gsap) {
      const newTarget = cfg.pos.clone();
      gsap.to(this.camTarget, {
        x: newTarget.x * 0.5, z: newTarget.z * 0.5,
        duration: 0.85, ease: 'power2.inOut',
        onUpdate: () => this._syncCamera(),
      });
    }
  }

  _addSelectionRing(pos, color) {
    const geo = new THREE.RingGeometry(2.05, 2.25, 32);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.09, pos.z);
    ring.name = 'selection-ring';
    ring.renderOrder = 3;
    this.scene.add(ring);
    this.tempAnims.push({
      obj: ring,
      update: (delta) => {
        ring.userData.age = (ring.userData.age || 0) + delta;
        const pulse = Math.sin(ring.userData.age * 3.5) * 0.06;
        ring.scale.set(1 + pulse, 1, 1 + pulse);
        mat.opacity = 0.5 + Math.sin(ring.userData.age * 2.5) * 0.25;
        return false; // never auto-remove; removed by _removeSelectionRing
      },
    });
  }

  _removeSelectionRing() {
    const old = this.scene.getObjectByName('selection-ring');
    if (old) {
      this.scene.remove(old);
      this.tempAnims = this.tempAnims.filter(a => a.obj !== old);
    }
  }

  _nearestEnemy(actorName) {
    const aPos = NATION_CFG[actorName]?.pos;
    if (!aPos) return null;
    let nearest = null, minD = Infinity;
    Object.entries(this.nations).forEach(([n, data]) => {
      if (n === actorName || data.eliminated) return;
      const d = NATION_CFG[n]?.pos.distanceTo(aPos) ?? Infinity;
      if (d < minD) { minD = d; nearest = n; }
    });
    return nearest;
  }

  // ══════════════════════════════════════════════════════════════
  // EVENT ANIMATIONS
  // ══════════════════════════════════════════════════════════════

  animateWar(attackerName, defenderName) {
    if (!attackerName || !defenderName) return;
    const aCfg = NATION_CFG[attackerName];
    const dCfg = NATION_CFG[defenderName];
    if (!aCfg || !dCfg) return;

    this._cameraShake(0.12, 0.5);

    // Spawn a war party (6-10 soldiers)
    const count = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const offset = new THREE.Vector3((Math.random()-0.5)*0.7, 0, (Math.random()-0.5)*0.7);
      const startPos = aCfg.pos.clone().add(offset);
      startPos.y = 0.14;

      // Soldier body
      const bGeo = new THREE.CylinderGeometry(0.068, 0.09, 0.28, 6);
      const bMat = new THREE.MeshStandardMaterial({ color: aCfg.troopColor });
      const body = new THREE.Mesh(bGeo, bMat);
      body.position.copy(startPos);
      body.castShadow = true;
      this.scene.add(body);

      // Soldier head
      const hGeo = new THREE.SphereGeometry(0.079, 6, 5);
      const hMat = new THREE.MeshStandardMaterial({ color: aCfg.helmColor });
      const head = new THREE.Mesh(hGeo, hMat);
      head.position.copy(startPos);
      head.position.y += 0.22;
      this.scene.add(head);

      // March to defender
      const delay    = i * 0.11;
      const dur      = 2.6 + Math.random() * 0.7;
      const tX       = dCfg.pos.x + (Math.random()-0.5)*0.9;
      const tZ       = dCfg.pos.z + (Math.random()-0.5)*0.9;

      const cleanup  = () => {
        this.scene.remove(body, head);
        this._createBattleExplosion(dCfg.pos.clone());
        this._flashZone(defenderName, 0xff2200, 850);
        this._cameraShake(0.2, 0.35);
      };

      if (window.gsap) {
        gsap.to(body.position, { x: tX, z: tZ, duration: dur, delay, ease: 'power1.inOut' });
        gsap.to(head.position, {
          x: tX, z: tZ, duration: dur, delay, ease: 'power1.inOut',
          onComplete: i === 0 ? cleanup : null,
        });
        // Bob while marching
        gsap.to([body.position, head.position], {
          y: '+=0.08', duration: 0.3, repeat: Math.ceil(dur / 0.3),
          yoyo: true, ease: 'sine.inOut', delay,
        });
      } else {
        setTimeout(cleanup, (delay + dur) * 1000);
        setTimeout(() => { this.scene.remove(body, head); }, (delay + dur) * 1000 + 100);
      }
    }

    // Show marching dust trail
    this._createDustTrail(aCfg.pos, dCfg.pos);
  }

  _createDustTrail(from, to) {
    const N   = 18;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const vel = [];
    const progress = new Array(N).fill(0).map(() => Math.random());

    for (let i = 0; i < N; i++) {
      const t = progress[i];
      pos[i*3]   = from.x + (to.x - from.x) * t;
      pos[i*3+1] = 0.1;
      pos[i*3+2] = from.z + (to.z - from.z) * t;
      vel.push({ dx: (Math.random()-0.5)*0.3, dz: (Math.random()-0.5)*0.3, dy: 0.4+Math.random()*0.6 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({ color: 0x8b7355, size: 0.14, transparent: true, opacity: 0.55, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);

    let elapsed = 0;
    this.tempAnims.push({ obj: pts, update: (dt) => {
      elapsed += dt;
      mat.opacity = Math.max(0, 0.55 - elapsed * 0.35);
      if (elapsed > 3.5) { this.scene.remove(pts); return true; }
      return false;
    }});
  }

  _createBattleExplosion(position) {
    const N   = 65;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const vel = [];

    const palette = [
      new THREE.Color(0xff4400), new THREE.Color(0xff8800),
      new THREE.Color(0xffcc00), new THREE.Color(0xffffff),
      new THREE.Color(0xff2200),
    ];

    for (let i = 0; i < N; i++) {
      pos[i*3] = position.x; pos[i*3+1] = position.y + 0.4; pos[i*3+2] = position.z;
      const a = Math.random() * Math.PI * 2;
      const s = 0.5 + Math.random() * 4.2;
      vel.push({ x: Math.cos(a)*s, y: 0.8+Math.random()*5.5, z: Math.sin(a)*s });
      const c = palette[Math.floor(Math.random() * palette.length)];
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.17, transparent: true, opacity: 1.0, vertexColors: true,
      depthWrite: false, sizeAttenuation: true,
    });
    const explosion = new THREE.Points(geo, mat);
    explosion.renderOrder = 5;
    this.scene.add(explosion);

    // Explosive flash light
    const flash = new THREE.PointLight(0xff6600, 8, 5);
    flash.position.copy(position); flash.position.y += 0.5;
    this.scene.add(flash);
    setTimeout(() => this.scene.remove(flash), 250);

    let elapsed = 0;
    this.tempAnims.push({ obj: explosion, update: (dt) => {
      elapsed += dt;
      const posA = explosion.geometry.attributes.position;
      for (let i = 0; i < N; i++) {
        posA.setX(i, posA.getX(i) + vel[i].x * dt);
        posA.setY(i, Math.max(0, posA.getY(i) + (vel[i].y - 9.8 * elapsed) * dt));
        posA.setZ(i, posA.getZ(i) + vel[i].z * dt);
      }
      posA.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - elapsed * 1.1);
      if (elapsed > 1.8) { this.scene.remove(explosion); return true; }
      return false;
    }});
  }

  animateAlliance(n1, n2) {
    const a = NATION_CFG[n1];
    const b = NATION_CFG[n2];
    if (!a || !b) return;

    // Diplomatic caravan
    const wGeo = new THREE.BoxGeometry(0.18, 0.12, 0.30);
    const wMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.65 });
    const wagon = new THREE.Mesh(wGeo, wMat);
    wagon.position.copy(a.pos); wagon.position.y = 0.06;
    this.scene.add(wagon);

    // Connection beam (green)
    const pts  = [a.pos.clone().setY(1.6), b.pos.clone().setY(1.6)];
    const lGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lMat = new THREE.LineBasicMaterial({ color: 0x27ae60, transparent: true, opacity: 0.8 });
    const beam = new THREE.Line(lGeo, lMat);
    this.scene.add(beam);

    const removeBeam = () => {
      let op = lMat.opacity;
      const fade = setInterval(() => {
        op -= 0.06;
        lMat.opacity = op;
        if (op <= 0) { this.scene.remove(beam); clearInterval(fade); }
      }, 80);
    };

    if (window.gsap) {
      gsap.to(wagon.position, {
        x: b.pos.x, z: b.pos.z, duration: 3.2, ease: 'power1.inOut',
        onComplete: () => {
          this.scene.remove(wagon);
          this._createGoldBurst(b.pos.clone());
          setTimeout(removeBeam, 1200);
        },
      });
    } else {
      setTimeout(() => { this.scene.remove(wagon); this.scene.remove(beam); }, 3500);
    }
  }

  animateTrade(fromName, toName) {
    const a = NATION_CFG[fromName];
    const b = NATION_CFG[toName];
    if (!a || !b) return;

    const wGeo = new THREE.BoxGeometry(0.15, 0.10, 0.24);
    const wMat = new THREE.MeshStandardMaterial({ color: 0xf39c12, roughness: 0.8 });
    const wagon = new THREE.Mesh(wGeo, wMat);
    wagon.position.copy(a.pos); wagon.position.y = 0.05;
    this.scene.add(wagon);

    const done = () => {
      this.scene.remove(wagon);
      this._createGoldBurst(b.pos.clone());
    };

    if (window.gsap) {
      gsap.to(wagon.position, { x: b.pos.x, z: b.pos.z, duration: 2.4, ease: 'none', onComplete: done });
    } else {
      setTimeout(done, 2400);
    }
  }

  animateDevelop(nationName) {
    const cfg = NATION_CFG[nationName];
    if (!cfg) return;

    // Expanding cyan tech ring
    const geo = new THREE.RingGeometry(0.7, 1.0, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x60b0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(cfg.pos); ring.position.y = 0.18;
    ring.renderOrder = 4;
    this.scene.add(ring);

    if (window.gsap) {
      gsap.to(mat, { opacity: 0.85, duration: 0.35, yoyo: true, repeat: 5, onComplete: () => this.scene.remove(ring) });
      gsap.to(ring.scale, { x: 3, y: 3, z: 3, duration: 2.8, ease: 'power2.out', onComplete: () => this.scene.remove(ring) });
    } else {
      setTimeout(() => this.scene.remove(ring), 2800);
    }
  }

  // Helpers for animations
  _flashZone(name, color, ms) {
    const zone = this.zonesMesh[name];
    if (!zone || this.nations[name]?.eliminated) return;
    const origC = NATION_CFG[name].color;
    zone.material.color.set(color);
    zone.material.opacity = 0.55;
    setTimeout(() => { zone.material.color.set(origC); zone.material.opacity = 0.13; }, ms);
  }

  _createGoldBurst(position) {
    const N   = 28;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const vel = [];

    for (let i = 0; i < N; i++) {
      pos[i*3] = position.x; pos[i*3+1] = position.y + 0.3; pos[i*3+2] = position.z;
      const a = Math.random() * Math.PI * 2;
      vel.push({ x: Math.cos(a)*(0.4+Math.random()*2), y: 1.2+Math.random()*3, z: Math.sin(a)*(0.4+Math.random()*2) });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({ color: 0xf4d03f, size: 0.13, transparent: true, opacity: 1, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 5;
    this.scene.add(pts);

    let elapsed = 0;
    this.tempAnims.push({ obj: pts, update: (dt) => {
      elapsed += dt;
      const pa = pts.geometry.attributes.position;
      for (let i = 0; i < N; i++) {
        pa.setX(i, pa.getX(i) + vel[i].x * dt);
        pa.setY(i, Math.max(0, pa.getY(i) + (vel[i].y - 8*elapsed)*dt));
        pa.setZ(i, pa.getZ(i) + vel[i].z * dt);
      }
      pa.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - elapsed);
      if (elapsed > 1.4) { this.scene.remove(pts); return true; }
      return false;
    }});
  }

  // ══════════════════════════════════════════════════════════════
  // CAMERA SHAKE
  // ══════════════════════════════════════════════════════════════

  _cameraShake(intensity, duration) {
    this.shakeData = { intensity, duration, elapsed: 0 };
  }

  _applyShake(dt) {
    if (!this.shakeData) return;
    this.shakeData.elapsed += dt;
    if (this.shakeData.elapsed >= this.shakeData.duration) { this.shakeData = null; return; }
    const t = 1 - this.shakeData.elapsed / this.shakeData.duration;
    const s = this.shakeData.intensity * t;
    this.camera.position.x += (Math.random()-0.5) * s;
    this.camera.position.y += (Math.random()-0.5) * s * 0.4;
    this.camera.position.z += (Math.random()-0.5) * s;
  }

  // ══════════════════════════════════════════════════════════════
  // INPUT
  // ══════════════════════════════════════════════════════════════

  _setupInput() {
    const c = this.renderer.domElement;
    c.addEventListener('click',       this._onClick);
    c.addEventListener('mousedown',   this._onMDown);
    c.addEventListener('mousemove',   this._onMMove);
    c.addEventListener('mouseup',     this._onMUp);
    c.addEventListener('mouseleave',  () => { this.isDragging = false; });
    c.addEventListener('wheel',       this._onWheel, { passive: false });
    c.addEventListener('contextmenu', this._onCMenu);
    // Touch support
    c.addEventListener('touchstart',  e => { if (e.touches.length === 1) { const t = e.touches[0]; this._onMDown({ button: 0, clientX: t.clientX, clientY: t.clientY }); } }, { passive: true });
    c.addEventListener('touchmove',   e => { if (e.touches.length === 1) { const t = e.touches[0]; this._onMMove({ buttons: 1, clientX: t.clientX, clientY: t.clientY }); } }, { passive: true });
    c.addEventListener('touchend',    () => this._onMUp());
  }

  _onClick(e) {
    if (this.wasDragging) { this.wasDragging = false; return; }
    const [mx, my] = this._toNDC(e.clientX, e.clientY);
    this.mouse.set(mx, my);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.clickTargets.map(t => t.mesh);
    const hits   = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const entry = this.clickTargets.find(t => t.mesh === hits[0].object);
      if (entry) {
        const { nation } = entry;
        if (!this.nations[nation]?.eliminated) {
          this.selectNation(nation);
          this.cb.onSelect?.(nation);
        }
      }
    }
  }

  _onMDown(e) {
    this.isDragging   = true;
    this.isRightBtn   = e.button === 2;
    this.lastMx       = e.clientX;
    this.lastMy       = e.clientY;
    this.dragStartX   = e.clientX;
    this.dragStartY   = e.clientY;
    this.wasDragging  = false;
  }

  _onMMove(e) {
    if (!this.isDragging) { this._checkHover(e); return; }
    const dx = e.clientX - this.lastMx;
    const dy = e.clientY - this.lastMy;
    if (Math.abs(e.clientX - this.dragStartX) > 3 || Math.abs(e.clientY - this.dragStartY) > 3) this.wasDragging = true;

    if (e.buttons === 2 || this.isRightBtn) {
      // Right-drag: pan
      const s = this.camDist * 0.0012;
      this.camTarget.x -= Math.cos(this.camAz) * dx * s;
      this.camTarget.z += Math.sin(this.camAz) * dx * s;
      this.camTarget.x += Math.sin(this.camAz) * dy * s * 0.5;
      this.camTarget.z += Math.cos(this.camAz) * dy * s * 0.5;
      this.camTarget.x = Math.max(-9, Math.min(9, this.camTarget.x));
      this.camTarget.z = Math.max(-9, Math.min(9, this.camTarget.z));
    } else {
      // Left-drag: orbit
      this.camAz -= dx * 0.008;
      this.camEl  = Math.max(0.15, Math.min(1.38, this.camEl - dy * 0.006));
    }
    this.lastMx = e.clientX;
    this.lastMy = e.clientY;
  }

  _onMUp()    { this.isDragging = false; }
  _onCMenu(e) { e.preventDefault(); }
  _onWheel(e) {
    e.preventDefault();
    this.camDist = Math.max(3.5, Math.min(22, this.camDist + e.deltaY * 0.012));
  }

  _checkHover(e) {
    const [mx, my] = this._toNDC(e.clientX, e.clientY);
    this.mouse.set(mx, my);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickTargets.map(t => t.mesh), false);
    const tooltip = document.getElementById('map-tooltip');

    if (hits.length > 0) {
      const entry  = this.clickTargets.find(t => t.mesh === hits[0].object);
      const name   = entry?.nation;
      const n      = name && this.nations[name];
      const cfg    = name && NATION_CFG[name];
      if (name && cfg && tooltip) {
        tooltip.innerHTML = n?.eliminated
          ? `<div class="map-tooltip-name" style="color:rgba(192,57,43,0.7);">☠ ${name}</div>
             <div class="map-tooltip-stat"><span>Status</span><span style="color:#e74c3c;">Eliminated</span></div>`
          : `<div class="map-tooltip-name" style="color:${cfg.colorStr};">${cfg.crest} ${name}</div>
             <div class="map-tooltip-stat"><span>⚔ Army</span><span>${Math.round(n?.army||0)}</span></div>
             <div class="map-tooltip-stat"><span>♛ Gold</span><span>${Math.round(n?.gold||0)}</span></div>
             <div class="map-tooltip-stat"><span>♟ Pop</span><span>${Math.round(n?.population||0).toLocaleString()}</span></div>
             <div class="map-tooltip-stat"><span>☯ Mood</span><span>${Math.round((n?.happiness||0)*100)}%</span></div>`;
        const cRect = this.container.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - cRect.left + 14}px`;
        tooltip.style.top  = `${e.clientY - cRect.top  - 10}px`;
        tooltip.classList.add('active');
        this.renderer.domElement.style.cursor = 'pointer';
      }
    } else {
      tooltip?.classList.remove('active');
      this.renderer.domElement.style.cursor = 'default';
    }
  }

  _toNDC(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return [
       ((cx - rect.left) / rect.width)  * 2 - 1,
      -((cy - rect.top)  / rect.height) * 2 + 1,
    ];
  }

  // ══════════════════════════════════════════════════════════════
  // MAIN LOOP
  // ══════════════════════════════════════════════════════════════

  _loop() {
    requestAnimationFrame(this._loop);
    const dt   = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    this._syncCamera();
    this._applyShake(dt);
    this._tickFlags(dt);
    this._tickTroops(dt);
    this._tickSmoke(dt);
    this._tickTempAnims(dt);
    this._tickGlowLights();
    this._tickOceanLight();

    this.renderer.render(this.scene, this.camera);
  }

  // ── Flags ────────────────────────────────────────────────────
  _tickFlags(dt) {
    this.flags.forEach(flag => {
      const geo = flag.geometry;
      const attr = geo.attributes.position;
      const origZ = geo._origZ;
      if (!origZ) return;
      const fw = flag.userData.fw || 0.7;

      for (let i = 0; i < attr.count; i++) {
        const x    = attr.getX(i);
        // Normalize x from [-fw/2, fw/2] → [0, 1]; 0 = pole, 1 = free edge
        const norm = Math.max(0, (x + fw * 0.5) / fw);
        const wave = Math.sin(norm * 5.5 - this.time * 4.2) * 0.065 * norm;
        attr.setZ(i, origZ[i] + wave);
      }
      attr.needsUpdate = true;
    });
  }

  // ── Troops ───────────────────────────────────────────────────
  _tickTroops(dt) {
    Object.values(this.troopSystems).forEach(sys => {
      const { bodies, heads, weapons, troopData, count, capital } = sys;
      let dirty = false;

      for (let i = 0; i < MAX_TROOPS; i++) {
        const t = troopData[i];

        if (!t.active || i >= count) {
          this._m4.makeScale(0, 0, 0);
          bodies.setMatrixAt(i, this._m4);
          heads.setMatrixAt(i, this._m4);
          weapons.setMatrixAt(i, this._m4);
          dirty = true;
          continue;
        }

        t.angle += t.speed * dt;

        const px = capital.x + Math.cos(t.angle) * t.radius;
        const pz = capital.z + Math.sin(t.angle) * t.radius;
        const py = 0.14 + Math.sin(t.bobPhase + this.time * 2.6) * 0.028;

        // Face direction of travel
        const fa = t.angle + (t.speed > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
        this._q.setFromAxisAngle(this._up, fa);
        this._s.set(1, 1, 1);

        // Body
        this._v3.set(px, py, pz);
        this._m4.compose(this._v3, this._q, this._s);
        bodies.setMatrixAt(i, this._m4);

        // Head
        this._v3.y = py + 0.22;
        this._m4.compose(this._v3, this._q, this._s);
        heads.setMatrixAt(i, this._m4);

        // Weapon (slight forward-right offset)
        this._v3.set(
          px + Math.cos(fa + 0.5) * 0.1,
          py + 0.12,
          pz + Math.sin(fa + 0.5) * 0.1,
        );
        this._m4.compose(this._v3, this._q, this._s);
        weapons.setMatrixAt(i, this._m4);

        dirty = true;
      }

      if (dirty) {
        bodies.instanceMatrix.needsUpdate  = true;
        heads.instanceMatrix.needsUpdate   = true;
        weapons.instanceMatrix.needsUpdate = true;
      }
    });
  }

  // ── Smoke ────────────────────────────────────────────────────
  _tickSmoke(dt) {
    this.smokeList.forEach(pts => {
      const { base, prog, ox, oz, N } = pts.userData;
      const attr = pts.geometry.attributes.position;

      for (let i = 0; i < N; i++) {
        prog[i] += dt * 0.38;
        if (prog[i] > 1) {
          prog[i] = 0;
          attr.setXYZ(i, base.x, base.y, base.z);
          ox[i] = (Math.random()-0.5) * 0.34;
          oz[i] = (Math.random()-0.5) * 0.34;
        }
        const p = prog[i];
        attr.setX(i, base.x + ox[i] * p);
        attr.setY(i, base.y + p * 2.6);
        attr.setZ(i, base.z + oz[i] * p);
      }
      attr.needsUpdate = true;
      pts.material.opacity = 0.22 + Math.sin(this.time * 1.8 + pts.id) * 0.07;
    });
  }

  // ── Temp animations ──────────────────────────────────────────
  _tickTempAnims(dt) {
    this.tempAnims = this.tempAnims.filter(item => !item.update(dt));
  }

  // ── Glow lights ──────────────────────────────────────────────
  _tickGlowLights() {
    let i = 0;
    Object.values(this.glowLights).forEach(light => {
      if (light.intensity === 0) return; // eliminated
      light.intensity = 0.75 + Math.sin(this.time * 3.8 + i * 1.6) * 0.18 + Math.sin(this.time * 7.5 + i * 0.9) * 0.08;
      i++;
    });
  }

  // ── Ocean shimmer ────────────────────────────────────────────
  _tickOceanLight() {
    if (this._oceanLight) {
      this._oceanLight.intensity = 1.0 + Math.sin(this.time * 0.6) * 0.3;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CLEANUP
  // ══════════════════════════════════════════════════════════════

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    window.civWorld = null;
  }
}

// ─────────────────────────────────────────────────────────────────
// FACTORY EXPORT
// ─────────────────────────────────────────────────────────────────
export function initWorld(container, callbacks = {}) {
  const world = new CivWorld3D(container, callbacks);
  world.init();
  return world;
}
