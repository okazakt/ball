import { laminateFloorGeometry } from './floor-laminate.js';
import { FRAME_DEFAULTS, FRAME_CONTROLS, frameGeometry, prepareFramePlastic, applyFrameSettings } from './frame-plastic.js';
import { prepareSpatialMaterial, updateSpatialMaterial, exposureAt } from './spatial-lighting.js';
import { FLOOR_THICKNESS, floorRectangles, doorSpec, doorPose, doorEdge, slotSkyVisibility, rampHull, footprint, HOLE_RADIUS, insideGoal, goalEdge, direction } from './mechanics.js';
import { inspectDraw } from './wall-diagnostics.js';
import { FIXED_WALL_SETTINGS } from './wall-settings.js';
import { COLS, ROWS, GAP } from './stage.js';
import { solidGeometry, spaceTexture, lidReflectionMaterial, ribMaterials, WALL_DEFAULTS, applyWallSettings, wallGeometry, curvedWallGeometry, prepareClearWall, studioEnvironment } from './case-visuals.js';
const T = window.THREE,
  GRAVITY = 32,
  TILT_GRAVITY = 51,
  MAX_TILT = 0.5,
  LID_Y = 1.07,
  CASE_WIDTH = COLS + 0.2,
  CASE_DEPTH = ROWS + 0.2,
  clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
  cellPos = (x, z) => ({ x: x - (COLS - 1) / 2, z: z - (ROWS - 1) / 2 });
export class Game {
  constructor(host, sound, events) {
    this.host = host;
    this.sound = sound;
    this.events = events;
    this.target = { x: 0, z: 0 };
    this.tilt = { x: 0, z: 0 };
    this.state = 'idle';
    this.keys = new Set();
    this.pointers = new Map();
    this.frame = 0;
    this.elapsed = 0;
    this.noise = 0;
    this.activeFloor = 0;
    this.ready = false;
    this.gyro = false;
    this.quest = true;
    this.wallSettings = { ...FIXED_WALL_SETTINGS };
    this.frameSettings = { ...FRAME_DEFAULTS };
    this.wallMaterials = new Set();
    this.wallColliders = [];
    this.rippleGeometry=new T.RingGeometry(.12,.145,32);
    this.rippleMaterial=new T.MeshBasicMaterial({color:0xffc17c,transparent:true,opacity:.7,depthTest:false,depthWrite:false,side:T.DoubleSide});
    this.setupInput();
  }
  updateFrameSettings(patch) {
    const before = { ...this.frameSettings };
    for (const [key,,min,max] of FRAME_CONTROLS) {
      if (Number.isFinite(patch[key])) this.frameSettings[key] = clamp(patch[key], min, max);
    }
    const rebuild = before.frameBevel !== this.frameSettings.frameBevel ||
      before.frameCornerRadius !== this.frameSettings.frameCornerRadius;
    this.board?.traverse(mesh => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const plastics = materials.filter(material => material?.userData?.frameUniforms);
      if (!plastics.length) return;
      for (const material of plastics) applyFrameSettings(material, this.frameSettings);
      if (rebuild && mesh.userData.frameGeometryFactory) {
        const old = mesh.geometry;
        mesh.geometry = mesh.userData.frameGeometryFactory();
        old.dispose();
      }
    });
    if (this.ready && this.stage) this.renderScene();
  }
  updateWallSettings(patch) {
    const oldRadius = this.wallSettings.cornerRadius, oldThickness = this.wallSettings.wallThickness;
    Object.assign(this.wallSettings, FIXED_WALL_SETTINGS);
    for (const material of this.wallMaterials) applyWallSettings(material, this.wallSettings);
    if (oldThickness !== this.wallSettings.wallThickness) this.updateWallColliders();
    if (oldRadius !== this.wallSettings.cornerRadius || oldThickness !== this.wallSettings.wallThickness) {
      clearTimeout(this.wallGeometryTimer);
      // Rebuild only after the thumb pauses, so the other controls stay fluid.
      this.wallGeometryTimer = setTimeout(() => this.refreshWallGeometry(), 80);
    }
    this.renderScene();
  }
  wallHalfExtents(vertical, door = false) {
    const thickness = this.wallSettings.wallThickness;
    const half = 0.038 * thickness + 0.012;
    const length = door ? 0.5 + 0.038 * (thickness - 1) : 0.5 + half;
    return { x: vertical ? half : length, y: 0.5, z: vertical ? length : half };
  }
  updateWallColliders() {
    for (const { collider, vertical, door } of this.wallColliders)
      collider.setHalfExtents(this.wallHalfExtents(vertical, door));
    for (const ball of this.balls || []) ball.body.wakeUp();
  }
  refreshWallGeometry() {
    if (!this.board) return;
    this.board.traverse(mesh => {
      const factory = mesh.userData.wallGeometryFactory;
      if (!factory) return;
      const geometry = factory(), texture = prepareClearWall(geometry);
      mesh.geometry.dispose(); mesh.material.alphaMap.dispose();
      mesh.geometry = geometry; mesh.material.alphaMap = texture;
      mesh.material.userData.wallDistance.value = texture;
      mesh.material.userData.wallShapeThickness.value = geometry.userData.wallThickness;
      if (mesh.userData.wallCollider) {
        const vertices = geometry.attributes.position.array;
        mesh.userData.wallCollider.setShape(new this.R.TriMesh(vertices,
          Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i)));
      }
      mesh.material.userData.wallTexel.value.set(1 / texture.image.width, 1 / texture.image.height);
    });
    this.renderScene();
  }
  async init() {
    const { default: R } = await import('../vendor/rapier.es.js');
    await R.init();
    this.R = R;
    this.scene = new T.Scene();
    this.board = new T.Group();
    this.scene.add(this.board);
    this.camera = new T.PerspectiveCamera(18, 1, 0.1, 100);
    this.camera.layers.enableAll();
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputEncoding = T.sRGBEncoding;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.autoClear = false;
    this.environmentTarget = studioEnvironment(this.renderer);
    this.scene.environment = this.environmentTarget.texture;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.host.prepend(this.renderer.domElement);
    this.ambient = new T.HemisphereLight(0xc3e9ff, 0x103140, 0.875);
    this.scene.add(this.ambient);
    this.lowerAmbient = new T.HemisphereLight(0x8199ad,0x080b12,.035);
    this.lowerAmbient.layers.set(2);
    this.scene.add(this.lowerAmbient);
    this.sun = new T.DirectionalLight(0xffecd0, 3.0);
    this.sun.position.set(4, 12, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.normalBias = 0.015;
    this.sun.shadow.radius = 4;
    Object.assign(this.sun.shadow.camera, { left: -7, right: 7, top: 8, bottom: -8 });
    this.scene.add(this.sun);
    this.sunTarget = new T.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    new ResizeObserver(() => this.resize()).observe(this.host);
    this.resize();
    this.ready = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }
  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Fit the lid without stretching either axis, including short/wide screens.
    this.viewHeight = Math.max(CASE_DEPTH, CASE_WIDTH / this.camera.aspect);
    this.viewWidth = this.viewHeight * this.camera.aspect;
    this.distance = this.viewHeight / (2 * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)));
    this.updateCamera();
  }
  updateCamera() {
    const lidY = LID_Y;
    // Limit visual obliqueness independently of the physical control range.
    const eyeX = -Math.tan(this.tilt.z * .3) * this.distance;
    const eyeZ = -Math.tan(this.tilt.x * .3) * this.distance;
    // Keep the optical axis perpendicular to the lid. The asymmetric frustum
    // passes through its four corners, so only objects below it show parallax.
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(eyeX, lidY + this.distance, eyeZ);
    this.camera.lookAt(eyeX, lidY, eyeZ);
    const scale = this.camera.near / this.distance;
    this.camera.projectionMatrix.makePerspective(
      (-this.viewWidth / 2 - eyeX) * scale,
      (this.viewWidth / 2 - eyeX) * scale,
      (this.viewHeight / 2 + eyeZ) * scale,
      (-this.viewHeight / 2 + eyeZ) * scale,
      this.camera.near,
      this.camera.far
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld(true);
  }
  material(color, glass = true) {
    return new T.MeshPhysicalMaterial({
      color,
      roughness: glass ? 0.22 : 0.4,
      metalness: glass ? 0.08 : 0.45,
      transparent: glass,
      opacity: glass ? 0.78 : 1,
      transmission: glass ? 0.25 : 0,
      thickness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
      envMapIntensity: 0.22,
    });
  }
  mesh(geo, mat, x, y, z, f = 0, parent = this.board) {
    const isWall = mat.isWallTemplate;
    if (isWall) {
      mat = ribMaterials(this.wallSettings, geo);
      this.wallMaterials.add(mat);
    }
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.layers.set(f + 1);
    if (isWall) {
      m.userData.wallFloor = f;
      m.onAfterRender = () => {
        if (this.wallDiagnosticCapture) this.wallDiagnosticCapture.push(inspectDraw(this.renderer, m));
      };
    }
    if (isWall) m.onBeforeRender = () => {
      const top = m.position.y + m.geometry.boundingBox.max.y;
      m.material.userData.wallBottomContact.value = clamp(1 - Math.abs(m.position.y + m.geometry.boundingBox.min.y + f * GAP) / 0.07, 0, 1);
      // The lid's underside is at floor + 1. Opening doors lose the weld glow.
      m.material.userData.wallContact.value = clamp(1 - Math.abs(top - (-f * GAP + 1)) / 0.07, 0, 1);
    };
    if (this.stage?.floors[f]?.dark)
      for (const material of Array.isArray(m.material) ? m.material : [m.material])
        if (material.envMapIntensity !== undefined) material.envMapIntensity = 0;
    parent.add(m);
    return m;
  }
  box(x, y, z, w, h, d, mat, f, collider = true) {
    const m = this.mesh(new T.BoxGeometry(w, h, d), mat, x, y, z, f);
    if (collider)
      this.world.createCollider(
        this.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
          .setTranslation(x, y, z)
          .setFriction(0.1)
          .setRestitution(h > 0.24 ? 0.7 : 0.1)
      );
    return m;
  }
  load(stage, quest = true) {
    if (!this.ready) return;
    if (stage.floors.length !== 2) throw Error('上段・下段の2段構造にしてください');
    if (!['S', 'M'].includes(stage.size)) throw Error('玉サイズはSまたはMを指定してください');
    clearTimeout(this.wallGeometryTimer);
    this.stopRecording(true);
    this.queue?.free();
    this.world?.free();
    while (this.board.children.length) {
      const o = this.board.children[0];
      o.traverse((n) => {
        n.geometry?.dispose();
        if (n.material) for (const material of Array.isArray(n.material) ? n.material : [n.material]) {
          material.map?.dispose();
          material.alphaMap?.dispose();
          material.dispose();
        }
      });
      this.board.remove(o);
    }
    this.world = new this.R.World({ x: 0, y: -GRAVITY, z: 0 });
    this.queue = new this.R.EventQueue(true);
    this.stage = stage;
    this.quest = quest;
    this.balls = [];
    this.enemies = [];
    this.doors = [];
    this.ramps = [];
    this.goalSurfaces = [];
    this.effects = [];
    this.ripples = [];
    this.lastRipple = -1;
    this.floorGroups = [];
    this.lidReflections = [];
    this.activeFloor = 0;
    this.elapsed = 0;
    this.acc = 0;
    this.noise = 0;
    this.target = { x: 0, z: 0 };
    this.tilt = { x: 0, z: 0 };
    this.jumpAt = -10;
    this.state = 'ready';
    this.logStride =
      3 +
      stage.balls.length * 9 +
      stage.floors.reduce(
        (n, f) => n + f.cells.filter((c) => ['robot', 'spider', 'slime'].includes(c.type)).length,
        0
      ) *
        5 +
      stage.floors.reduce((n, f) => n + f.cells.filter((c) => c.type === 'door').length, 0) * 2;
    this.log = new Float32Array(18000 * this.logStride);
    this.logCount = 0;
    this.logHead = 0;
    this.logAcc = 0;
    this.outcome = null;
    this.recordedBlob = null;
    this.viewFloor = 0;
    this.board.rotation.set(0, 0, 0);
    this.updateCamera();
    this.wallMaterials.clear();
    this.wallColliders = [];
    stage.floors.forEach((f, fi) => {
      const y = -fi * GAP;
      const group = new T.Group();
      this.board.add(group);
      this.floorGroups.push(group);
      const start = this.board.children.length;
      const wall = { isWallTemplate: true };
      const floorRects = floorRectangles(stage, fi);
      for (const [x0,z0,x1,z1] of floorRects)
        this.world.createCollider(this.R.ColliderDesc.cuboid((x1-x0)/2, FLOOR_THICKNESS/2, (z1-z0)/2)
          .setTranslation((x0+x1)/2, y-FLOOR_THICKNESS/2, (z0+z1)/2).setFriction(0.1).setRestitution(0.1));
      if (floorRects.length) {
        const floorGeo = solidGeometry(floorRects.map(rect => rect.map(v => v * 100)), FLOOR_THICKNESS);
        const positions = floorGeo.attributes.position, uvs = floorGeo.attributes.uv;
        for (let i = 0; i < positions.count; i++)
          uvs.setXY(i, positions.getX(i) / COLS + 0.5, 0.5 - positions.getZ(i) / ROWS);
        const floorMat = this.floorMaterials(fi);
        const floorMesh = this.mesh(fi === 0 ? laminateFloorGeometry(floorGeo) : floorGeo, floorMat, 0, y - FLOOR_THICKNESS, 0, fi);
        floorMesh.userData.surface = 'floor';
        for (const goal of f.cells.filter(c => c.type === 'goal')) this.paintGoalReveal(floorMesh, goal, 'floor', fi);
      }
      const perimeter = w => w.axis === 'h' ? w.z === 0 || w.z === ROWS : w.x === 0 || w.x === COLS;
      const exits = f.cells.filter(c => c.type === 'goal').map(goalEdge);
      const wallsForFloor = f.walls.filter(w => !exits.some(e => e && e.axis === w.axis && e.x === w.x && e.z === w.z));
      const wallRects = wallsForFloor.filter(w => !perimeter(w)).map(w => {
        const x = (w.x - COLS / 2) * 100, z = (w.z - ROWS / 2) * 100;
        return [x - 3.8, z - 3.8, x + (w.axis === 'h' ? 103.8 : 3.8), z + (w.axis === 'v' ? 103.8 : 3.8)];
      });
      if (wallRects.length) {
        const factory = () => wallGeometry(wallRects, this.wallSettings);
        const walls = this.mesh(factory(), wall, 0, y, 0, fi);
        walls.userData.wallGeometryFactory = factory;
        walls.castShadow = false;
        walls.userData.surface = 'walls';
      }
      const frameRects = wallsForFloor.filter(perimeter).map(w => {
        let x = (w.x - COLS / 2) * 100, z = (w.z - ROWS / 2) * 100;
        if (w.axis === 'h') {
          z += w.z === 0 ? -2.5 : 2.5;
          return [x - 7.5, z - 5, x + 107.5, z + 5];
        }
        x += w.x === 0 ? -2.5 : 2.5;
        return [x - 5, z - 7.5, x + 5, z + 107.5];
      });
      if (frameRects.length) {
        const height = fi === 0 ? LID_Y + FLOOR_THICKNESS : GAP + FLOOR_THICKNESS;
        const factory = () => frameGeometry(frameRects, height, this.frameSettings);
        const frame = this.mesh(factory(), prepareFramePlastic(this.casePlastic(), this.frameSettings, height),
          0, fi === 0 ? y : y-FLOOR_THICKNESS, 0, fi);
        frame.userData.frameGeometryFactory = factory;
        frame.userData.surface = 'frame';
        for (const goal of f.cells.filter(c => c.type === 'goal')) this.paintGoalReveal(frame, goal, 'frame', fi);
        if (fi > 0) for (const goal of stage.floors[fi-1].cells.filter(c => c.type === 'goal'))
          this.paintGoalReveal(frame, goal, 'threshold', fi-1);
        frame.castShadow = false;
      }
      for (const w of wallsForFloor) {
        const p = cellPos(w.x, w.z), vertical = w.axis === 'v';
        const half = perimeter(w) ? { x: vertical ? 0.05 : 0.55, y: 0.5, z: vertical ? 0.55 : 0.05 }
          : this.wallHalfExtents(vertical);
        const collider = this.world.createCollider(this.R.ColliderDesc.cuboid(half.x, half.y, half.z)
          .setTranslation(p.x + (w.axis === 'h' ? 0 : -0.5), y + 0.5,
            p.z + (w.axis === 'h' ? -0.5 : 0)).setFriction(0.1).setRestitution(0.7));
        if (!perimeter(w)) this.wallColliders.push({ collider, vertical, door: false });
      }
      if (fi === 0) {
      const coverMat = new T.MeshPhysicalMaterial({
        color: 0xffffff, transparent: true, opacity: 0.012,
        roughness: 0.08, metalness: 0, clearcoat: 1, envMapIntensity: 0.25,
        depthWrite: false,
      });
      const cover = this.box(0, y + 1.035, 0, CASE_WIDTH, 0.07, CASE_DEPTH, coverMat, fi, false);
      cover.castShadow = cover.receiveShadow = false;
      cover.userData.surface = 'lid';
      // Each ball collides with its own floor's lid, but can pass the next lid
      // while falling. Group 1 is shared by balls and all ordinary obstacles.
      this.world.createCollider(this.R.ColliderDesc.cuboid(CASE_WIDTH / 2, 0.035, CASE_DEPTH / 2)
        .setTranslation(0, y + 1.035, 0).setRestitution(0.7).setFriction(0.1)
        .setCollisionGroups(((1 << (fi + 1)) << 16) | 1));
      const reflection = this.mesh(new T.PlaneGeometry(CASE_WIDTH, CASE_DEPTH),
        lidReflectionMaterial(), 0, y + LID_Y + 0.001, 0, fi);
      reflection.rotation.x = -Math.PI / 2;
      reflection.castShadow = reflection.receiveShadow = false;
      reflection.renderOrder = 100;
      reflection.userData.dynamic = true;
      this.lidReflections.push(reflection);
      }
      for (const c of f.cells) {
        const p = cellPos(c.x, c.z);
        if (c.type === 'hole') {
          this.createHoleFloor(c, y, fi);
          const ring = this.mesh(
            new T.TorusGeometry(HOLE_RADIUS + .018, .018, 8, 64),
            this.material(0xffc36e, false),
            p.x,
            y + 0.01,
            p.z,
            fi
          );
          ring.rotation.x = Math.PI / 2;
          let bottom = fi + 1;
          while (
            bottom < stage.floors.length - 1 &&
            stage.floors[bottom].cells.some((h) => h.type === 'hole' && h.x === c.x && h.z === c.z)
          )
            bottom++;
          const depth = (bottom - fi) * GAP;
          // Soft local daylight through the opening, rather than lower-room sun.
          const beam = new T.SpotLight(0xbceeff, 1.2, depth + 2, .6, .7, 1);
          beam.position.set(p.x, y + 0.5, p.z);
          beam.target.position.set(p.x, y - depth, p.z);
          beam.layers.disableAll();
          for (let li = fi + 1; li <= bottom; li++) beam.layers.enable(li + 1);
          beam.userData.persistentLight = true;
          beam.target.userData.persistentLight = true;
          this.board.add(beam, beam.target);
          const poolCanvas = document.createElement('canvas'); poolCanvas.width = poolCanvas.height = 128;
          const poolContext = poolCanvas.getContext('2d');
          const gradient = poolContext.createRadialGradient(64,64,0,64,64,64);
          gradient.addColorStop(0,'rgba(140,180,205,.16)');
          gradient.addColorStop(.5,'rgba(100,145,180,.08)');
          gradient.addColorStop(1,'rgba(80,120,160,0)');
          poolContext.fillStyle = gradient; poolContext.fillRect(0,0,128,128);
          const pool = this.mesh(new T.PlaneGeometry(1.5,1.5),new T.MeshBasicMaterial({
            map:new T.CanvasTexture(poolCanvas),transparent:true,depthWrite:false,
            blending:T.AdditiveBlending }),p.x,y-depth+.006,p.z,bottom);
          pool.rotation.x = -Math.PI/2; pool.userData.persistentLight = true;
          const glow = this.mesh(
            new T.CylinderGeometry(HOLE_RADIUS, .65, depth, 48, 1, true),
            new T.MeshBasicMaterial({
              color: 0xb1e9f4,
              transparent: true,
              opacity: 0.012,
              depthWrite: false,
              side: T.DoubleSide,
              blending: T.AdditiveBlending,
            }),
            p.x,
            y - depth / 2,
            p.z,
            fi + 1
          );
          glow.userData.persistentLight = true;
        }
        if (c.type === 'goal') this.createGoalExit(c, y, fi);
        if (c.type === 'sticky') {
          const mesh = this.box(
            p.x,
            y + 0.015,
            p.z,
            0.88,
            0.03,
            0.88,
            this.material(0xb94bc0),
            fi,
            false
          );
          mesh.material.emissive = new T.Color(0x290a35);
          for (let j = 0; j < 5; j++)
            this.box(
              p.x - 0.35 + j * 0.175,
              y + 0.035,
              p.z,
              0.015,
              0.01,
              0.8,
              this.material(0xf299ea, false),
              fi,
              false
            );
        }
        if (c.type === 'switch') {
          const mesh = this.mesh(
            new T.CylinderGeometry(0.27, 0.3, 0.06, 20),
            this.material(0xffc374, false),
            p.x,
            y + 0.03,
            p.z,
            fi
          );
          this.effects.push({ mesh, type: 'switch', f: fi, c });
        }
        if (c.type === 'door') this.createLiftDoor(c, fi);
        if (c.type === 'ramp') this.createRamp(c);
        if (c.type === 'corner') {
          const factory = () => curvedWallGeometry(c.rotation || 0, this.wallSettings);
          const geometry = factory();
          const corner = this.mesh(geometry, wall, p.x, y, p.z, fi);
          corner.userData.wallGeometryFactory = factory;
          corner.castShadow = false;
          corner.userData.surface = 'walls';
          const vertices = geometry.attributes.position.array;
          corner.userData.wallCollider = this.world.createCollider(this.R.ColliderDesc.trimesh(vertices,
            Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i))
            .setTranslation(p.x, y, p.z).setFriction(0.1).setRestitution(0.7));
        }
        if (['robot', 'spider', 'slime'].includes(c.type)) this.createEnemy(c, fi);
      }
      // Keep each floor independently visible during floor changes and replays.
      for (const child of this.board.children.slice(start))
        if (child !== group && !child.userData.persistentLight) group.add(child);
      this.batchFloor(group);
    });
    const radius = { S: 0.35, M: 0.4 }[stage.size];
    stage.balls.forEach((p, i) => {
      const fi = p.floor ?? 0, startY = -fi * GAP;
      const pos = cellPos(p.x, p.z),
        body = this.world.createRigidBody(
          this.R.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, startY + radius + 0.02, pos.z)
            .setLinearDamping(0.02)
            .setAngularDamping(0.02)
            .setCcdEnabled(true)
        );
      const collider = this.world.createCollider(
        this.R.ColliderDesc.ball(radius)
          .setCollisionGroups((1 << 16) | 3)
          .setDensity({ S: 0.7, M: 1.4 }[stage.size])
          .setFriction(0.1)
          .setRestitution(0.7)
          .setRestitutionCombineRule(this.R.CoefficientCombineRule.Min)
          .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS),
        body
      );
      const texture = document.createElement('canvas');
      texture.width = 128;
      texture.height = 64;
      const ctx = texture.getContext('2d');
      ctx.fillStyle = ['#ffaf55', '#b4f6c7', '#ede4b3'][i];
      ctx.fillRect(0, 0, 128, 64);
      ctx.strokeStyle = ['#914a30', '#237f76', '#a7854d'][i];
      ctx.lineWidth = 9;
      for (let j = -64; j < 192; j += 32) {
        ctx.beginPath();
        ctx.moveTo(j, 0);
        ctx.lineTo(j + 65, 64);
        ctx.stroke();
      }
      const mat = this.material(0xffffff, false);
      mat.map = new T.CanvasTexture(texture);
      mat.roughness = 0.13;
      mat.metalness = 0.2;
      prepareSpatialMaterial(mat);
      const mesh = this.mesh(
        new T.SphereGeometry(radius, 24, 16),
        mat,
        pos.x,
        startY + radius + 0.02,
        pos.z,
        fi
      );
      const light = new T.PointLight(['#ffbb77', '#b4f6c7', '#fff2b6'][i], 1.3, 2.2, 1.4);
      light.layers.set(1);light.layers.enable(2);light.userData.baseIntensity=1.3;
      mesh.add(light);
      this.balls.push({
        body,
        collider,
        mesh,
        light,
        radius,
        floor: fi,
        done: false,
        sticky: 0,
        prevSpeed: 0,
      });
    });
    this.movingLights=[];
    this.board.traverse(light=>{if(light.isPointLight||light.isSpotLight){
      light.userData.spatialPosition=new T.Vector3();light.userData.spatialTarget=new T.Vector3();this.movingLights.push(light);
    }});
    this.updateWallSettings({});
    this.sync();
    this.warmupRenderVariants();
    this.events.loaded?.();
  }
  warmupRenderVariants() {
    // Moving a point light to the other floor changes Three.js shader variants.
    // Draw every distribution, including the first lower ripple, before play.
    const state=this.state, saved=this.balls.map(b=>({floor:b.displayFloor,done:b.displayDone,
      meshMask:b.mesh.layers.mask,lightMask:b.light.layers.mask}));
    this.state='playing';
    const ripple=this.mesh(this.rippleGeometry,this.rippleMaterial,0,.025,0,0);
    ripple.rotation.x=-Math.PI/2;
    try {
      for(let lower=0;lower<=this.balls.length;lower++) {
        this.balls.forEach((b,i)=>{
          const fi=i<lower?1:0;b.displayFloor=fi;b.displayDone=false;
          b.mesh.layers.set(fi+1);b.light.layers.set(fi+1);
        });
        this.updateLowerRipples(1);
        this.renderScene();
      }
    } finally {
      ripple.parent.remove(ripple);
      this.clearRipples();this.state=state;
      this.balls.forEach((b,i)=>{b.displayFloor=saved[i].floor;b.displayDone=saved[i].done;
        b.mesh.layers.mask=saved[i].meshMask;b.light.layers.mask=saved[i].lightMask;});
      this.renderScene();
    }
    this.prewarmedPrograms=this.renderer.info.programs.length;
  }
  casePlastic() {
    return new T.MeshPhysicalMaterial({ color: 0x269c67, roughness: .1, metalness: 0,
      clearcoat: 1, clearcoatRoughness: .03, ior: 1.52, envMapIntensity: 2 });
  }
  floorMaterials(fi, bottom = 0) {
    const paper = this.floorMaterial(fi);
    if (fi !== 0) return paper;
    const core = prepareFramePlastic(this.casePlastic(), this.frameSettings, FLOOR_THICKNESS, bottom);
    return [paper, core];
  }
  floorMaterial(fi) {
    // Both floors use the same printed paper. Only the room lighting differs.
    return new T.MeshStandardMaterial({ color: 0xffffff,
      map: spaceTexture(), roughness: 1, metalness: 0, envMapIntensity: 0 });
  }
  createHoleFloor(c, y, fi) {
    const p = cellPos(c.x,c.z), shape = new T.Shape();
    shape.moveTo(-.5,-.5); shape.lineTo(.5,-.5); shape.lineTo(.5,.5); shape.lineTo(-.5,.5); shape.closePath();
    const hole = new T.Path(); hole.absarc(0,0,HOLE_RADIUS,0,2*Math.PI,true); shape.holes.push(hole);
    const geometry = new T.ExtrudeGeometry(shape,{depth:FLOOR_THICKNESS,bevelEnabled:false,curveSegments:32})
      .rotateX(-Math.PI/2).translate(0,-FLOOR_THICKNESS,0);
    const positions = geometry.attributes.position, uv = geometry.attributes.uv;
    for(let i=0;i<positions.count;i++) uv.setXY(i,(positions.getX(i)+p.x)/COLS+.5,.5-(positions.getZ(i)+p.z)/ROWS);
    const mesh = this.mesh(fi === 0 ? laminateFloorGeometry(geometry) : geometry,
      this.floorMaterials(fi,-FLOOR_THICKNESS),p.x,y,p.z,fi);
    mesh.userData.surface = 'hole-floor';
    this.world.createCollider(this.R.ColliderDesc.trimesh(positions.array,
      Uint32Array.from({length:positions.count},(_,i)=>i)).setTranslation(p.x,y,p.z).setFriction(.1).setRestitution(.1));
  }
  createRamp(c) {
    const vertices = rampHull(c), geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(vertices, 3));
    const faces = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]], indices = [];
    const center = new T.Vector3();
    for (let i=0;i<8;i++) center.add(new T.Vector3().fromArray(vertices,i*3));
    center.multiplyScalar(1/8);
    const [dx,dz] = direction(c);
    for (let [index, face] of faces.entries()) {
      // Adjacent ramps share their full-width top; no internal side face/ridge.
      const across = index === 3 ? 1 : index === 5 ? -1 : 0;
      if (across && this.stage.floors[0].cells.some(other => other.type === 'ramp'
        && (other.rotation ?? 0) === (c.rotation ?? 0)
        && other.x === c.x - dz*across && other.z === c.z + dx*across)) continue;
      const a = new T.Vector3().fromArray(vertices,face[0]*3), b = new T.Vector3().fromArray(vertices,face[1]*3), d = new T.Vector3().fromArray(vertices,face[2]*3);
      if (b.clone().sub(a).cross(d.clone().sub(a)).dot(a.clone().sub(center)) < 0) face = [...face].reverse();
      indices.push(face[0],face[1],face[2],face[0],face[2],face[3]);
    }
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = this.mesh(geometry, this.casePlastic(), 0, 0, 0, 0);
    mesh.userData.surface = 'ramp'; mesh.castShadow = false;
    const desc = this.R.ColliderDesc.convexHull(vertices);
    if (!desc) throw Error('坂道の立体形状を生成できません');
    const collider = this.world.createCollider(desc.setFriction(.15).setRestitution(0));
    this.ramps.push({ c, mesh, collider });
    // The open ramp also admits light into the lower chamber near its entrance.
    const p = cellPos(c.x,c.z);
    const light = new T.PointLight(0xc3e9ff,.85,2.6,1.5);
    light.position.set(p.x+dx*.5,.45,p.z+dz*.5); light.layers.set(2);
    light.visible = !this.stage.floors[0].dark;
    this.board.add(light);
  }
  createLiftDoor(c, fi) {
    const spec=doorSpec(c,fi),pose=doorPose(spec,0);
    const body=this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(spec.x,pose.panelY,spec.z));
    const collider=this.world.createCollider(this.R.ColliderDesc.cuboid(spec.halfX,.46,spec.halfZ).setFriction(.1).setRestitution(0),body);
    const factory = () => frameGeometry([[-spec.halfX*100,-spec.halfZ*100,spec.halfX*100,spec.halfZ*100]], .92, this.frameSettings, true);
    const mesh=this.mesh(factory(),prepareFramePlastic(prepareSpatialMaterial(this.casePlastic()),this.frameSettings,.92,-.46),spec.x,pose.panelY,spec.z,fi);
    mesh.userData.frameGeometryFactory = factory;
    mesh.userData.dynamic=true;mesh.userData.surface='door';mesh.castShadow=false;
    const postBody=this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(spec.x,pose.postY,spec.z));
    const postCollider=this.world.createCollider(this.R.ColliderDesc.cylinder(pose.postHeight/2,.055).setFriction(.1).setRestitution(0),postBody);
    const post=this.mesh(new T.CylinderGeometry(.055,.055,1,32),prepareFramePlastic(this.casePlastic(),this.frameSettings,1,-.5),spec.x,pose.postY,spec.z,1);
    post.scale.y=pose.postHeight;post.userData.dynamic=true;post.userData.surface='door-post';post.castShadow=false;
    this.doors.push({c,fi,...spec,body,collider,postBody,postCollider,mesh,post,slide:0,nextSlide:0,open:false});
  }
  setDoorVisual(door, retraction) {
    const pose=doorPose(door,retraction);door.slide=retraction;
    door.mesh.position.set(door.x,pose.panelY,door.z);
    door.post.position.set(door.x,pose.postY,door.z);door.post.scale.y=pose.postHeight;
  }
  releaseDoorBall(door,retraction) {
    if(retraction>=door.slide)return true;
    const next=doorPose(door,retraction),bottom=next.panelY-.46,top=next.panelY+.46;
    for(const b of this.balls) {
      if(b.done)continue;
      const p=b.body.translation(),r=b.radius;
      const normal=(p.x-door.x)*door.dx+(p.z-door.z)*door.dz;
      const tangent=-(p.x-door.x)*door.dz+(p.z-door.z)*door.dx;
      if(Math.abs(normal)>=door.halfThickness+r+.012 || Math.abs(tangent)>door.halfLength+r
        || p.y+r<bottom || p.y-r>top+.015)continue;
      const v=b.body.linvel();
      const preferred=Math.abs(normal)>.001?Math.sign(normal):Math.sign(v.x*door.dx+v.z*door.dz)||-1;
      let released=false;
      for(const extra of [0,.12,.24,.4])for(const side of [preferred,-preferred]) {
        if(released)break;
        const distance=side*(door.halfThickness+r+.015+extra)-normal;
        const floorY=-b.floor*GAP+r;
        // A ball can settle a few millimetres into the open slot. Lift only
        // that small rim sag before testing an otherwise free escape side.
        const targetY=p.y>floorY-.04&&p.y<floorY+.01?Math.max(p.y,floorY+.002):p.y;
        const target={x:p.x+door.dx*distance,y:targetY,z:p.z+door.dz*distance};
        if(Math.abs(target.x)>COLS/2-r || Math.abs(target.z)>ROWS/2-r)continue;
        let blocked=false;
        this.world.intersectionsWithShape(target,b.body.rotation(),new this.R.Ball(r-.006),other=>{
          if(![b.collider.handle,door.collider.handle,door.postCollider.handle].includes(other.handle))blocked=true;
          return true;
        });
        if(blocked)continue;
        b.body.setTranslation(target,true);
        const outward=Math.max(.8,Math.abs(v.x*door.dx+v.z*door.dz));
        const along=-v.x*door.dz+v.z*door.dx;
        b.body.setLinvel({x:-door.dz*along+door.dx*side*outward,y:Math.min(v.y,0),z:door.dx*along+door.dz*side*outward},true);
        released=true;
      }
      // If another object leaves neither side free, wait rather than crush.
      if(!released)return false;
    }
    return true;
  }
  paintGoalReveal(mesh, cell, kind, fi) {
    const p = cellPos(cell.x, cell.z), [dx,dz] = direction(cell);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const previous = material.onBeforeCompile.bind(material);
      const previousKey = material.customProgramCacheKey.bind(material);
      material.onBeforeCompile = shader => {
        previous(shader);
        shader.uniforms.goalPaintFloorY = {value:-fi*GAP-mesh.position.y};
        shader.uniforms.goalPaintTopY = {value:fi === 0 ? LID_Y+FLOOR_THICKNESS : GAP};
        shader.uniforms.goalPaintCenter = {value:new T.Vector2(p.x,p.z)};
        shader.uniforms.goalPaintDirection = {value:new T.Vector2(dx,dz)};
        shader.vertexShader = 'varying vec3 vGoalPaintPosition;\n'+shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvGoalPaintPosition = position;');
        shader.fragmentShader = 'varying vec3 vGoalPaintPosition; uniform float goalPaintFloorY; uniform float goalPaintTopY; uniform vec2 goalPaintCenter; uniform vec2 goalPaintDirection;\n'+shader.fragmentShader;
        // Paint the original rounded surface itself, including its bevels and
        // full depth. Apply after display conversion to retain pure red/white.
        shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
          #include <dithering_fragment>
          vec2 goalDelta = vGoalPaintPosition.xz-goalPaintCenter;
          float goalAlong = dot(goalDelta,goalPaintDirection);
          float goalAcross = dot(goalDelta,vec2(-goalPaintDirection.y,goalPaintDirection.x));
          float goalHeight = vGoalPaintPosition.y-goalPaintFloorY;
          bool goalFootprint = abs(goalAcross) <= .50 ||
            length(vec2(goalAlong-.50,abs(goalAcross)-.50)) <= .151;
          bool goalReveal = goalAlong >= .349 && goalAlong <= .701 &&
            ${kind === 'frame'
              ? '((abs(goalAcross) > .339 && abs(goalAcross) < .661) || (goalFootprint && goalHeight <= .003 && goalHeight >= -.242))'
              : kind === 'threshold'
                ? '(goalFootprint && goalHeight <= .003 && goalHeight >= -.242)'
                : 'goalFootprint'};
          if (goalReveal) {
            float goalStripe = ${kind === 'frame' ? '(goalHeight <= .003 ? (goalAcross+.5)*10. : goalHeight*10.)' : '(goalAcross+.5)*10.'};
            gl_FragColor = vec4(mod(floor(goalStripe),2.) < 1. ? vec3(1.,0.,0.) : vec3(1.),1.);
            ${kind === 'frame' ? 'if (goalHeight > goalPaintTopY-.06) gl_FragColor = vec4(1.,0.,0.,1.);' : ''}
          }

        `);
      };
      material.customProgramCacheKey = () => previousKey()+'-goal-solid-paint-v4-'+kind;
      material.needsUpdate = true;
      material.userData.goalPaint = kind;
    }
  }
  createGoalExit(cell, y, fi) {
    this.goalSurfaces.push({cell,fi});
    const p=cellPos(cell.x,cell.z), [dx,dz]=direction(cell), radius=.15;
    // Two horizontal quarter disks fill only the square corners at the ends
    // of the original projecting floor paint. The jambs stay unchanged.
    for(const side of [-1,1]){
      const shape=new T.Shape();
      shape.moveTo(0,0);shape.lineTo(-radius,0);
      shape.absarc(0,0,radius,Math.PI,side===1?Math.PI/2:Math.PI*1.5,side===1);
      shape.lineTo(0,0);shape.closePath();
      const geometry=new T.ExtrudeGeometry(shape,{
        depth:FLOOR_THICKNESS,bevelEnabled:false,curveSegments:32
      });
      const positions=geometry.attributes.position, stripe=[];
      for(let i=0;i<positions.count;i++){
        const along=.5+positions.getX(i),across=side*.5+positions.getY(i);
        const h=positions.getZ(i)-FLOOR_THICKNESS;
        stripe.push(across);
        positions.setXYZ(i,p.x+dx*along-dz*across,y+h+.002,p.z+dz*along+dx*across);
      }
      geometry.setAttribute('cornerStripe',new T.Float32BufferAttribute(stripe,1));
      geometry.computeVertexNormals();
      const material=new T.ShaderMaterial({
        side:T.DoubleSide,toneMapped:false,
        vertexShader:'attribute float cornerStripe;varying float vStripe;void main(){vStripe=cornerStripe;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'varying float vStripe;void main(){float s=mod(floor((vStripe+.5)*10.),2.);gl_FragColor=vec4(s<1.?vec3(1.,0.,0.):vec3(1.),1.);}'
      });
      const corner=this.mesh(geometry,material,0,0,0,fi);
      corner.castShadow=corner.receiveShadow=false;
      corner.userData.surface='goal-corner';
      const indices=geometry.index?Uint32Array.from(geometry.index.array):Uint32Array.from({length:positions.count},(_,i)=>i);
      this.world.createCollider(this.R.ColliderDesc.trimesh(Float32Array.from(positions.array),indices).setFriction(.1).setRestitution(.1));
    }
  }

  start() {
    if (this.state !== 'ready') return;
    this.keys.clear();
    this.pointers.clear();
    this.acc = 0;
    this.last = performance.now();
    this.balls.forEach((b) => b.body.wakeUp());
    this.state = 'playing';
  }
  batchFloor(group) {
    const buckets = new Map();
    for (const m of group.children)
      if (m.isMesh && !m.userData.dynamic && !m.userData.surface && m.material && !Array.isArray(m.material)) {
        const key = m.material.uuid;
        const list = buckets.get(key) || [];
        list.push(m);
        buckets.set(key, list);
      }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map((m) => {
        m.updateMatrix();
        return m.geometry.clone().applyMatrix4(m.matrix);
      });
      const merged = new T.BufferGeometry();
      for (const attribute of ['position', 'normal', 'uv']) {
        const size = geometries[0].attributes[attribute].itemSize;
        const length = geometries.reduce((n, g) => n + g.attributes[attribute].array.length, 0);
        const data = new Float32Array(length);
        let offset = 0;
        for (const g of geometries) {
          data.set(g.attributes[attribute].array, offset);
          offset += g.attributes[attribute].array.length;
        }
        merged.setAttribute(attribute, new T.BufferAttribute(data, size));
      }
      const indices = [];
      let offset = 0;
      for (const g of geometries) {
        if (g.index) for (const index of g.index.array) indices.push(index + offset);
        else for (let i = 0; i < g.attributes.position.count; i++) indices.push(i + offset);
        offset += g.attributes.position.count;
        g.dispose();
      }
      merged.setIndex(indices);
      const mesh = new T.Mesh(merged, meshes[0].material);
      mesh.layers.mask = meshes[0].layers.mask;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const old of meshes) {
        group.remove(old);
        old.geometry.dispose();
      }
    }
  }
  createEnemy(c, fi) {
    const p = cellPos(c.x, c.z),
      g = new T.Group();
    g.position.set(p.x, -fi * GAP, p.z);
    this.board.add(g);
    const metal = this.material(0x718a91, false),
      plastic = this.material(c.type === 'slime' ? 0x8e9ce8 : 0xff925d);
    const add = (geo, mat, x, y, z) => this.mesh(geo, mat, x, y, z, fi, g);
    if (c.type === 'slime') {
      const m = add(new T.SphereGeometry(0.3, 18, 12), plastic, 0, 0.22, 0);
      m.scale.y = 0.75;
    } else {
      add(new T.SphereGeometry(0.23, 16, 12), metal, 0, 0.58, 0);
      add(new T.CylinderGeometry(0.2, 0.17, 0.32, 12), plastic, 0, 0.31, 0);
      add(new T.SphereGeometry(0.12, 12, 8), this.material(0x8cf0af), 0, 0.31, 0);
      const count = c.type === 'spider' ? 6 : 2;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const leg = add(
          new T.BoxGeometry(0.09, 0.22, 0.12),
          metal,
          c.type === 'spider' ? Math.cos(a) * 0.3 : i ? -0.12 : 0.12,
          0.11,
          c.type === 'spider' ? Math.sin(a) * 0.3 : 0
        );
        leg.userData.leg = true;
      }
    }
    for (const x of [-0.075, 0.075])
      add(
        new T.SphereGeometry(0.035, 8, 6),
        new T.MeshBasicMaterial({ color: 0xff9f88 }),
        x,
        c.type === 'slime' ? 0.3 : 0.6,
        0.21
      );
    const shape = new T.Shape();
    shape.moveTo(0, 0);
    for (let j = 0; j <= 16; j++) {
      const a = -0.5 + j / 16;
      shape.lineTo(Math.sin(a) * 2, Math.cos(a) * 2);
    }
    shape.lineTo(0, 0);
    const cone = add(
      new T.ShapeGeometry(shape),
      new T.MeshBasicMaterial({
        color: 0xff2020,
        transparent: true,
        opacity: 0.38,
        side: T.DoubleSide,
        depthWrite: false,
      }),
      0,
      0.025,
      0
    );
    cone.rotation.x = Math.PI / 2;
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = 64;
    badgeCanvas.height = 64;
    const ctx = badgeCanvas.getContext('2d');
    ctx.fillStyle = '#ffbc6b';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 32, 52);
    const badge = new T.Sprite(
      new T.SpriteMaterial({ map: new T.CanvasTexture(badgeCanvas), depthTest: false })
    );
    badge.scale.set(0.45, 0.45, 1);
    badge.position.y = 1;
    badge.layers.set(fi + 1);
    g.add(badge);
    badge.visible = false;
    this.enemies.push({
      g,
      cone,
      badge,
      fi,
      c,
      x: p.x,
      z: p.z,
      dir: c.rotation || 0,
      heading: ((c.rotation || 0) * Math.PI) / 2,
      state: 'patrol',
      stun: 0,
      alert: 0,
      target: null,
      next: null,
    });
  }
  setupInput() {
    const center = () => {
      const a = [...this.pointers.values()];
      return a.reduce((s, p) => ({ x: s.x + p.x / a.length, y: s.y + p.y / a.length }), {
        x: 0,
        y: 0,
      });
    };
    this.host.addEventListener('pointerdown', (e) => {
      if (!this.ready || this.state !== 'playing') return;
      this.host.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pointerCenter = center();
      this.sound.start().catch(() => {});
    });
    this.host.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = center(),
        dx = c.x - this.pointerCenter.x,
        dy = c.y - this.pointerCenter.y;
      this.target.z = clamp(this.target.z + dx * 0.006, -MAX_TILT, MAX_TILT);
      this.target.x = clamp(this.target.x + dy * 0.006, -MAX_TILT, MAX_TILT);
      if (Math.abs(dx) > 18) this.shake(0.45);
      this.pointerCenter = c;
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      this.pointerCenter = center();
      if (!this.pointers.size && !this.gyro) this.target = { x: 0, z: 0 };
    };
    this.host.addEventListener('pointerup', end);
    this.host.addEventListener('pointercancel', end);
    window.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))
        return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
        this.keys.add(e.key);
        if (e.key === ' ' && !e.repeat) this.jump();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointers.clear();
      this.target = { x: 0, z: 0 };
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keys.clear();
        this.target = { x: 0, z: 0 };
        this.acc = 0;
        this.sound.roll(0);
      }
      this.last = performance.now();
    });
  }
  async enableGyro() {
    if (!window.DeviceOrientationEvent) throw Error('この端末はジャイロ非対応です');
    if (
      typeof DeviceOrientationEvent.requestPermission === 'function' &&
      (await DeviceOrientationEvent.requestPermission()) !== 'granted'
    )
      throw Error('センサーの許可が必要です');
    if (typeof window.DeviceMotionEvent?.requestPermission === 'function')
      await DeviceMotionEvent.requestPermission();
    this.gyro = true;
    this.gyroBase = null;
    this.orientationHandler ??= (e) => {
      if (!this.gyro || e.beta === null || e.gamma === null) return;
      this.gyroBase ??= { b: e.beta, g: e.gamma };
      this.target.x = clamp((e.beta - this.gyroBase.b) * 0.02, -MAX_TILT, MAX_TILT);
      this.target.z = clamp((e.gamma - this.gyroBase.g) * 0.02, -MAX_TILT, MAX_TILT);
    };
    window.addEventListener('deviceorientation', this.orientationHandler);
    this.motionHandler ??= (e) => {
      const a = e.acceleration;
      if (a && Math.hypot(a.x || 0, a.y || 0, a.z || 0) > 16) this.jump();
    };
    window.addEventListener('devicemotion', this.motionHandler);
  }
  shake(amount = 1) {
    for (const b of this.balls) {
      if (b.sticky > 0) b.sticky = Math.max(0, b.sticky - amount);
      const p = b.body.translation();
      this.makeNoise(p, b.floor, amount);
    }
  }
  jump() {
    if (this.state !== 'playing' || this.elapsed - this.jumpAt < 0.28) return;
    this.jumpAt = this.elapsed;
    this.shake(1);
    for (const b of this.balls) {
      if (b.done) continue;
      const p = b.body.translation(),
        ground = -b.floor * GAP;
      if (p.y < ground + b.radius + 0.14 && b.sticky <= 0)
        b.body.applyImpulse({ x: 0, y: b.body.mass() * 6.3, z: 0 }, true);
    }
    for (const e of this.enemies) e.stun = 1.4;
    this.sound.tone(0.6);
  }
  makeNoise(p, fi, power) {
    if (power < 0.25) return;
    this.noise = Math.max(this.noise, Math.min(1, power * 0.45));
    this.sound.tone(power);
    for (const e of this.enemies)
      if (e.fi === fi && Math.hypot(e.x - p.x, e.z - p.z) < power * 2.5) {
        e.target = { x: p.x, z: p.z };
        if (e.state === 'chase') continue;
        e.state = 'investigate';
        e.alert = 3;
        e.badge.material.color.set(0xffd66f);
      }
  }
  blocked(fi, x, z, nx, nz) {
    if (nx < 0 || nx >= COLS || nz < 0 || nz >= ROWS) return true;
    const f = this.stage.floors[fi],
      axis = x === nx ? 'h' : 'v',
      wx = axis === 'h' ? x : Math.max(x, nx),
      wz = axis === 'h' ? Math.max(z, nz) : z;
    if (f.walls.some((w) => w.axis === axis && w.x === wx && w.z === wz)) return true;
    if (f.cells.some((c) => c.x === nx && c.z === nz && ['hole', 'corner', 'ramp'].includes(c.type)))
      return true;
    return this.stage.floors[0].cells.some(c => c.type === 'ramp' && footprint(c).some(p => p.x === nx && p.z === nz)) ||
      this.doors.some(d => {
        const edge=doorEdge(d.c);
        return edge.axis===axis&&edge.x===wx&&edge.z===wz&&(fi===d.fi?!d.open:fi===1&&d.fi===0);
      });
  }
  clearSight(fi, a, b) {
    let px = Math.floor(a.x + COLS / 2),
      pz = Math.floor(a.z + ROWS / 2);
    const n = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) * 20);
    for (let j = 1; j <= n; j++) {
      const x = Math.floor(a.x + ((b.x - a.x) * j) / n + COLS / 2),
        z = Math.floor(a.z + ((b.z - a.z) * j) / n + ROWS / 2);
      if ((x !== px || z !== pz) && this.blocked(fi, px, pz, x, z)) return false;
      px = x;
      pz = z;
    }
    return true;
  }
  updateEnemies(dt) {
    const dirs = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    for (const e of this.enemies) {
      e.stun = Math.max(0, e.stun - dt);
      e.cone.visible = e.stun === 0;
      e.badge.visible = e.state !== 'patrol' && e.stun === 0;
      if (e.stun > 0) {
        e.g.rotation.z = Math.sin(this.elapsed * 15) * 0.15;
        continue;
      }
      e.g.rotation.z = 0;
      e.alert -= dt;
      let seen;
      for (const b of this.balls) {
        if (b.done || b.floor !== e.fi) continue;
        const p = b.body.translation(),
          dx = p.x - e.x,
          dz = p.z - e.z,
          d = Math.hypot(dx, dz);
        if (d < 0.38 + b.radius && Math.abs(p.y + e.fi * GAP) < 0.8) {
          this.finish(false, 'ゼリーに回収されました', b);
          return;
        }
        if (
          d < 2 &&
          Math.abs(
            Math.atan2(
              Math.sin(Math.atan2(dx, dz) - e.heading),
              Math.cos(Math.atan2(dx, dz) - e.heading)
            )
          ) < 0.5 &&
          this.clearSight(e.fi, e, p)
        ) {
          seen = p;
          break;
        }
      }
      if (seen) {
        if (e.state !== 'chase') this.sound.tone(0.5, 'alert');
        e.state = 'chase';
        e.alert = 3;
        e.target = { x: seen.x, z: seen.z };
        e.badge.material.color.set(0xff775e);
      } else if (e.alert <= 0) {
        e.state = 'patrol';
        e.target = null;
      }
      if (!e.next || Math.hypot(e.next.x - e.x, e.next.z - e.z) < 0.04) {
        const cx = clamp(Math.round(e.x + (COLS - 1) / 2), 0, COLS - 1),
          cz = clamp(Math.round(e.z + (ROWS - 1) / 2), 0, ROWS - 1);
        e.x = cx - (COLS - 1) / 2;
        e.z = cz - (ROWS - 1) / 2;
        let options = [0, 1, 2, 3].filter(
          (i) => !this.blocked(e.fi, cx, cz, cx + dirs[i][0], cz + dirs[i][1])
        );
        if (options.length) {
          if (e.target)
            options.sort((a, b) => {
              const pa = cellPos(cx + dirs[a][0], cz + dirs[a][1]),
                pb = cellPos(cx + dirs[b][0], cz + dirs[b][1]);
              return (
                Math.hypot(pa.x - e.target.x, pa.z - e.target.z) -
                Math.hypot(pb.x - e.target.x, pb.z - e.target.z)
              );
            });
          else if (e.c.rule === 'random') options.sort(() => Math.random() - 0.5);
          else {
            const order = e.c.rule === 'left' ? [3, 0, 1, 2] : [1, 0, 3, 2];
            options.sort(
              (a, b) => order.indexOf((a - e.dir + 4) % 4) - order.indexOf((b - e.dir + 4) % 4)
            );
          }
          e.dir = options[0];
          e.next = cellPos(cx + dirs[e.dir][0], cz + dirs[e.dir][1]);
        } else e.next = { x: e.x, z: e.z };
      }
      const dx = e.next.x - e.x,
        dz = e.next.z - e.z,
        d = Math.hypot(dx, dz);
      if (d > 0.001) {
        const speed = (e.state === 'chase' ? 1.4 : e.state === 'investigate' ? 0.85 : 0.46) * dt;
        e.x += (dx / d) * Math.min(d, speed);
        e.z += (dz / d) * Math.min(d, speed);
        e.heading = Math.atan2(dx, dz);
      }
      e.g.position.set(e.x, -e.fi * GAP, e.z);
      e.g.rotation.y = e.heading + (e.state === 'patrol' ? Math.sin(this.elapsed * 2) * 0.16 : 0);
      e.g.children.forEach((m, i) => {
        if (m.userData.leg) m.rotation.x = Math.sin(this.elapsed * 11 + i * Math.PI) * 0.3;
      });
      if (e.c.type === 'slime') e.g.scale.y = 1 + Math.sin(this.elapsed * 6) * 0.08;
    }
  }
  step(dt) {
    this.elapsed += dt;
    const old = { ...this.tilt };
    if (this.keys.size) {
      this.target.z =
        ((this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0)) * MAX_TILT;
      this.target.x =
        ((this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0)) * MAX_TILT;
    } else if (!this.pointers.size && !this.gyro) this.target = { x: 0, z: 0 };
    const response = 1 - Math.pow(1 - 0.35, dt * 60);
    this.tilt.x += (this.target.x - this.tilt.x) * response;
    this.tilt.z += (this.target.z - this.tilt.z) * response;
    if (Math.hypot(old.x - this.tilt.x, old.z - this.tilt.z) / dt > 1.6)
      for (const e of this.enemies) e.stun = 1.4;
    this.world.gravity = {
      x: Math.sin(this.tilt.z) * TILT_GRAVITY,
      y: -Math.cos(this.tilt.x) * Math.cos(this.tilt.z) * GRAVITY,
      z: Math.sin(this.tilt.x) * TILT_GRAVITY,
    };
    for (const d of this.doors) {
      const switched = this.stage.floors[d.fi].cells.some(
        (c) =>
          c.type === 'switch' &&
          this.balls.some(
            (b) =>
              !b.done &&
              b.floor === d.fi &&
              Math.hypot(
                b.body.translation().x - cellPos(c.x, c.z).x,
                b.body.translation().z - cellPos(c.x, c.z).z
              ) < 0.4
          )
      );
      d.open = switched || this.elapsed % 7 > 4;
      const target = d.open ? 1 : 0;
      d.nextSlide = d.slide + clamp(target-d.slide,-dt*1.8,dt*1.8);
      if(!this.releaseDoorBall(d,d.nextSlide))d.nextSlide=d.slide;
    }
    if (Math.hypot(this.tilt.x, this.tilt.z) > 0.001)
      for (const b of this.balls) if (!b.done) b.body.wakeUp();
    // Small toy clearances need substeps as well as CCD at high impact speeds.
    this.world.timestep = dt / 4;
    for (let substep = 0; substep < 4; substep++) {
      for (const door of this.doors) {
        const slide = door.slide+(door.nextSlide-door.slide)*(substep+1)/4;
        const pose=doorPose(door,slide);
        door.body.setNextKinematicTranslation({x:door.x,y:pose.panelY,z:door.z});
        door.postCollider.setHalfHeight(pose.postHeight/2);
        door.postBody.setNextKinematicTranslation({x:door.x,y:pose.postY,z:door.z});
      }
      this.world.step(this.queue);
      this.queue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        for (const b of this.balls)
          if (!b.done && (b.collider.handle === h1 || b.collider.handle === h2)) {
            const p = b.body.translation();
            const other = this.world.getCollider(b.collider.handle === h1 ? h2 : h1);
            if (other && other.translation().y > -b.floor * GAP + 0.1)
              this.makeNoise(p, b.floor, Math.max(0.3, b.prevSpeed * b.body.mass() * 6));
          }
      });
    }
    for (const door of this.doors) this.setDoorVisual(door,door.nextSlide);
    for (const b of this.balls) {
      if (b.done) continue;
      const p = b.body.translation(),
        v = b.body.linvel();
      b.prevSpeed = Math.hypot(v.x, v.y, v.z);
      if (this.goalSurfaces.some(goal => goal.fi === b.floor && insideGoal(p,b.radius,goal.cell,goal.fi))) {
        b.done = true;
        b.body.setBodyType(this.R.RigidBodyType.Fixed, true);
        b.collider.setSensor(true);
        b.mesh.visible = false;
        b.light.intensity = 0; b.light.userData.baseIntensity=0;
        this.sound.tone(0.7, 'alert');
      }
      if (b.done) continue;
      if (Math.abs(p.x) > COLS / 2 + 0.5 || Math.abs(p.z) > ROWS / 2 + 0.5 || p.y < -this.stage.floors.length * GAP) {
        this.finish(false, '盤面の外に落ちました', b);
        return;
      }
      const bottom = p.y-b.radius;
      const nextFloor = bottom < -.32 ? 1 : bottom > -.12 ? 0 : b.floor;
      if (nextFloor !== b.floor) {
        b.floor = nextFloor;
        b.mesh.layers.set(nextFloor+1);
      }
      const f = this.stage.floors[b.floor];
      const near = f.cells.filter((c) => {
        const q = cellPos(c.x, c.z);
        return (
          Math.abs(q.x - p.x) < 0.44 && Math.abs(q.z - p.z) < 0.44 && Math.abs(p.y-(-b.floor*GAP+b.radius)) < .16
        );
      });
      const sticky = near.some((c) => c.type === 'sticky');
      if (sticky && !b.wasSticky) b.sticky = 2.3;
      b.wasSticky = sticky;
      if (b.sticky > 0) {
        const door = this.doors.some(
          (d) =>
            d.fi === b.floor &&
            !d.open &&
            Math.hypot(d.mesh.position.x - p.x, d.mesh.position.z - p.z) < 0.6
        );
        if (door) b.sticky = 0;
        else {
          b.body.setLinvel({ x: v.x * 0.2, y: v.y, z: v.z * 0.2 }, true);
          this.events.status?.('磁力ネット！ シェイク連打で脱出');
        }
      }

    }
    this.updateEnemies(dt);
    if (this.state !== 'playing') return;
    this.activeFloor = Math.min(
      ...this.balls.filter((b) => !b.done).map((b) => b.floor),
      this.stage.floors.length - 1
    );
    this.viewFloor = 0;
    this.noise = Math.max(0, this.noise - dt * 0.5);

    this.logAcc += dt;
    if (this.logAcc >= 1 / 30) {
      this.logAcc -= 1 / 30;
      this.recordFrame();
    }
    if (this.balls.every((b) => b.done)) this.finish(true, 'すべての玉をゴールに導きました');
    else if (this.elapsed >= this.stage.limit)
      this.finish(
        false,
        'タイムオーバー',
        this.balls.find((b) => !b.done)
      );
  }
  sync() {
    for (const b of this.balls) {
      const p = b.body.translation(),
        q = b.body.rotation();
      b.mesh.position.set(p.x, p.y, p.z);
      b.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      b.displayFloor = b.floor;
      b.displayDone = b.done;
    }
  }
  setLighting() {
    const fi = this.viewFloor;
    for (const b of this.balls) {
      b.mesh.visible = !(b.displayDone ?? b.done);
      // Opaque floors occlude the ball naturally; openings reveal it on either floor.
      b.mesh.material.visible = true;
    }
    this.floorGroups.forEach((g, i) => (g.visible = i >= fi));
    this.ambient.layers.disableAll();
    this.sun.layers.disableAll();
    for (let i = 0; i < 1; i++)
      if (!this.stage.floors[i].dark) {
        this.ambient.layers.enable(i + 1);
        this.sun.layers.enable(i + 1);
      }
    this.lowerAmbient.visible = !this.stage.floors[1].dark;
    this.sun.position.set(4 + this.tilt.z * 12, 12 - fi * GAP, 3 + this.tilt.x * 10);
    this.sunTarget.position.set(0, -fi * GAP, 0);
    this.board.rotation.set(0, 0, 0);
    this.updateCamera();
    this.board.updateMatrixWorld(true);
    for(const light of this.movingLights){
      light.getWorldPosition(light.userData.spatialPosition);
      if(light.isSpotLight)light.target.getWorldPosition(light.userData.spatialTarget);
    }
    for(const b of this.balls)updateSpatialMaterial(this,b.mesh,exposureAt(b.mesh.position.y,b.radius));
    for(const door of this.doors){
      const top=door.mesh.position.y+.46;
      const sky=slotSkyVisibility(-top,door.halfLength+.012,door.halfThickness+.012);
      updateSpatialMaterial(this,door.mesh,exposureAt(top,.04)*sky,2);
    }
    for (let i = 0; i < this.lidReflections.length; i++) {
      const reflection = this.lidReflections[i];
      reflection.visible = i === fi;
      reflection.material.uniforms.tilt.value.set(this.tilt.z, -this.tilt.x);
    }
  }
  renderScene() {
    if (!this.renderer || !this.world || !this.stage) return;
    this.setLighting();
    this.renderer.clear();
    // Capture the unchanged scene without wall surfaces for internal scattering.
    if (!this.wallBackgroundTarget) this.wallBackgroundTarget = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType });
    const size = this.renderer.getDrawingBufferSize(new T.Vector2());
    if (this.wallBackgroundTarget.width !== size.x || this.wallBackgroundTarget.height !== size.y)
      this.wallBackgroundTarget.setSize(size.x, size.y);
    const hidden = [];
    this.board.traverse(mesh => {
      if (mesh.isMesh && this.wallMaterials.has(mesh.material) && mesh.visible) hidden.push(mesh);
    });
    // Three.js light layers select lights per camera, not per mesh. Render floors
    // separately so upper-floor sunlight never illuminates an unreached dark floor.
    for (let fi = this.stage.floors.length - 1; fi >= this.viewFloor; fi--) {
      this.camera.layers.set(fi + 1);
      for(const b of this.balls){
        const upper=exposureAt(b.mesh.position.y,b.radius);
        b.light.intensity=(b.light.userData.baseIntensity??1.3)*(fi===0?upper:1-upper);
      }
      if (this.wallSettings.resinDensity > 0) {
        for (const mesh of hidden) mesh.visible = false;
        this.renderer.setRenderTarget(this.wallBackgroundTarget);
        if (fi === this.stage.floors.length - 1) this.renderer.clear();
        const toneMapping = this.renderer.toneMapping;
        this.renderer.toneMapping = T.NoToneMapping;
        this.renderer.render(this.scene, this.camera);
        this.renderer.toneMapping = toneMapping;
        this.renderer.setRenderTarget(null);
        for (const mesh of hidden) mesh.visible = true;
      }
      for (const material of this.wallMaterials) {
        material.userData.wallBackground.value = this.wallBackgroundTarget.texture;
        material.userData.wallResolution.value.copy(size);
      }
      this.renderer.render(this.scene, this.camera);
    }
  }
  updateLowerRipples(dt) {
    for (const b of this.balls) {
      if (!['playing','replay'].includes(this.state) || (b.displayFloor ?? b.floor) !== 1 || (b.displayDone ?? b.done)) {
        b.rippleClock = 0; continue;
      }
      b.rippleClock = (b.rippleClock ?? 0) - dt;
      if (b.rippleClock > 0) continue;
      b.rippleClock = .4;
      const mesh = this.mesh(this.rippleGeometry,this.rippleMaterial.clone(),
        b.mesh.position.x,.025,b.mesh.position.z,0);
      mesh.rotation.x = -Math.PI/2; mesh.renderOrder = 1000;
      mesh.userData.surface = 'lower-ball-ripple';
      this.ripples.push({mesh,age:0});
    }
  }
  clearRipples() {
    for (const r of this.ripples) {
      r.mesh.parent?.remove(r.mesh); r.mesh.material.dispose();
    }
    this.ripples = [];
    this.balls.forEach(b => { b.rippleClock = 0; });
  }
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.world || document.hidden) return;
    if (this.state === 'playing' && !document.querySelector('dialog[open]')) {
      this.acc = Math.min(this.acc + dt, 0.1);
      while (this.acc >= 1 / 60 && this.state === 'playing') {
        this.step(1 / 60);
        this.acc -= 1 / 60;
      }
      this.sync();
    } else {
      this.sound.roll(0);
      if (this.state === 'replay') this.updateReplay(dt);
    }
    this.updateLowerRipples(dt);
    for (const r of this.ripples) {
      r.age += dt;
      r.mesh.scale.setScalar(1 + r.age * 7);
      r.mesh.material.opacity = Math.max(0, 0.7 - r.age);
    }
    this.ripples = this.ripples.filter((r) => {
      if (r.age < 0.7) return true;
      this.board.remove(r.mesh);
      r.mesh.material.dispose();
      return false;
    });
    this.renderScene();
    this.events.frame?.(this);
  }
  recordFrame() {
    const v = this.log,
      at = this.logHead * this.logStride;
    let i = at;
    v[i++] = this.elapsed;
    v[i++] = this.tilt.x;
    v[i++] = this.tilt.z;
    for (const b of this.balls) {
      const p = b.body.translation(),
        q = b.body.rotation();
      for (const n of [p.x, p.y, p.z, q.x, q.y, q.z, q.w, b.floor, b.done ? 1 : 0]) v[i++] = n;
    }
    for (const e of this.enemies)
      for (const n of [
        e.x,
        e.z,
        e.heading,
        e.stun,
        e.state === 'patrol' ? 0 : e.state === 'chase' ? 2 : 1,
      ])
        v[i++] = n;
    for (const d of this.doors) {
      v[i++] = d.slide;
      v[i++] = d.open ? 1 : 0;
    }
    this.logHead = (this.logHead + 1) % 18000;
    this.logCount = Math.min(this.logCount + 1, 18000);
  }
  exportLog() {
    const out = new Float32Array(this.logCount * this.logStride);
    for (let j = 0; j < this.logCount; j++) {
      const frame = (this.logHead - this.logCount + j + 18000) % 18000;
      out.set(
        this.log.subarray(frame * this.logStride, (frame + 1) * this.logStride),
        j * this.logStride
      );
    }
    return { frames: out, stride: this.logStride, count: this.logCount };
  }
  finish(won, reason, ball) {
    if (this.state !== 'playing') return;
    this.recordFrame();
    this.outcome = {
      won,
      reason,
      time: this.elapsed,
      floor: ball?.floor ?? this.activeFloor,
      ballIndex: this.balls.indexOf(ball),
    };
    this.state = 'finished';
    this.sound.roll(0);
    this.stopRecording();
    this.events.finished?.(this.outcome, this.exportLog());
    if (!won && this.logCount > 2) {
      this.autoReplay = setTimeout(() => this.playReplay(), 450);
    }
  }
  playReplay(full = false) {
    if (!this.outcome || this.logCount < 2) return;
    if (this.exportingVideo) this.stopRecording(true);
    this.clearRipples();
    clearTimeout(this.autoReplay);
    this.events.replaying?.();
    this.replay = this.exportLog();
    this.replayIndex = full ? 0 : Math.max(0, this.replay.count - 90);
    this.replayClock = 0;
    this.replayFinishTime = 0;
    this.balls.forEach((b) => b.mesh.scale.setScalar(1));
    this.captureMesh?.parent?.remove(this.captureMesh);
    this.captureMesh = null;
    this.state = 'replay';
    this.viewFloor = 0;
  }
  playSavedReplay(saved) {
    this.load(saved.stage, false);
    this.stopRecording();
    if (
      saved.stride !== this.logStride ||
      saved.count < 1 ||
      saved.count > 18000 ||
      saved.frames.length !== saved.count * saved.stride
    )
      throw Error('リプレイ形式が一致しません');
    this.log.set(saved.frames);
    this.logCount = saved.count;
    this.logHead = saved.count % 18000;
    this.outcome = saved.result;
    this.state = 'finished';
    this.playReplay(true);
  }
  updateReplay(dt) {
    this.replayClock += dt;
    while (this.replayClock >= 1 / 30 && this.replayIndex < this.replay.count) {
      this.replayClock -= 1 / 30;
      let i = this.replayIndex * this.logStride;
      const v = this.replay.frames;
      this.replayIndex++;
      i++;
      this.tilt.x = v[i++];
      this.tilt.z = v[i++];
      for (const b of this.balls) {
        b.mesh.position.set(v[i++], v[i++], v[i++]);
        b.mesh.quaternion.set(v[i++], v[i++], v[i++], v[i++]);
        const f = v[i++],
          done = v[i++];
        b.mesh.layers.set(f + 1);

        b.displayFloor = f;
        b.displayDone = done;
        b.mesh.visible = !done;
        b.light.intensity = done ? 0 : 1.3; b.light.userData.baseIntensity=done?0:1.3;
      }
      for (const e of this.enemies) {
        e.g.position.x = v[i++];
        e.g.position.z = v[i++];
        e.g.rotation.y = v[i++];
        e.cone.visible = v[i++] <= 0;
        e.badge.visible = v[i++] > 0;
      }
      for (const d of this.doors) {
        this.setDoorVisual(d, v[i++]);
        d.open = v[i++] > 0;
      }
    }
    if (this.replayIndex >= this.replay.count) {
      this.replayFinishTime += dt;
      const b = this.balls[this.outcome.ballIndex];
      if (b && this.outcome.reason.includes('ゼリー')) {
        if (!this.captureMesh) {
          this.captureMesh = this.mesh(
            new T.SphereGeometry(b.radius * 1.8, 20, 16),
            this.material(0xa3e9c5),
            b.mesh.position.x,
            b.mesh.position.y,
            b.mesh.position.z,
            b.floor
          );
          this.captureMesh.material.opacity = 0.35;
        }
        const t = Math.min(1, this.replayFinishTime / 0.85);
        this.captureMesh.scale.setScalar(0.2 + t);
        b.mesh.scale.setScalar(1 - t * 0.6);
      }
      if (this.replayFinishTime > 1) {
        this.state = 'finished';
        if (this.exportingVideo) this.stopRecording();
        this.events.replayEnd?.(this.outcome);
      }
    }
  }
  canExportVideo() {
    return !!(this.renderer?.domElement.captureStream && window.MediaRecorder);
  }
  exportReplayVideo() {
    if (!this.canExportVideo() || !this.outcome || this.logCount < 2 || this.exportingVideo) return false;
    this.playReplay(true);
    this.exportingVideo = true;
    if (this.startRecording()) return true;
    this.exportingVideo = false;
    this.state = 'finished';
    this.events.replayEnd?.(this.outcome);
    return false;
  }
  startRecording() {
    if (!this.renderer.domElement.captureStream || !window.MediaRecorder) {
      this.events.video?.(null);
      return false;
    }
    let stream;
    try {
      stream = this.renderer.domElement.captureStream(30);
      const mime = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
        MediaRecorder.isTypeSupported(t)
      );
      const recorder = new MediaRecorder(
          stream,
          mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : {}
        ),
        chunks = [];
      this.recorder = recorder;
      this.recordingStream = stream;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (this.recorder !== recorder) return;
        this.recorder = null;
        this.recordingStream = null;
        this.exportingVideo = false;
        if (recorder.discard) return;
        this.recordedBlob = new Blob(chunks, { type: recorder.mimeType });
        this.events.video?.(this.recordedBlob);
      };
      recorder.onerror = () => { this.stopRecording(true); this.events.video?.(null); };
      recorder.start(1000);
      return true;
    } catch {
      stream?.getTracks().forEach(t => t.stop());
      this.recorder = null; this.recordingStream = null;
      this.events.video?.(null);
      return false;
    }
  }
  stopRecording(discard = false) {
    if (discard) {
      this.exportingVideo = false;
      if (this.recorder) this.recorder.discard = true;
    }
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    if (discard) this.recordingStream?.getTracks().forEach(t => t.stop());
  }
}
