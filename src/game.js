import { COLS, ROWS, GAP } from './stage.js';
const T = window.THREE,
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
    this.setupInput();
  }
  async init() {
    const { default: R } = await import('../vendor/rapier.es.js');
    await R.init();
    this.R = R;
    this.scene = new T.Scene();
    const faces = Array.from({ length: 6 }, (_, i) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d'),
        g = x.createLinearGradient(0, 0, 64, 64);
      g.addColorStop(0, i === 2 ? '#9db7be' : '#162e3b');
      g.addColorStop(1, '#071119');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      x.fillStyle = i < 3 ? '#9cb8c6' : '#244855';
      x.fillRect(12, 8, 5, 40);
      return c;
    });
    const env = new T.CubeTexture(faces);
    env.encoding = T.sRGBEncoding;
    env.needsUpdate = true;
    this.scene.environment = env;
    this.board = new T.Group();
    this.scene.add(this.board);
    this.camera = new T.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.layers.enableAll();
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputEncoding = T.sRGBEncoding;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.host.prepend(this.renderer.domElement);
    this.ambient = new T.HemisphereLight(0xc3e9ff, 0x103140, 0.35);
    this.scene.add(this.ambient);
    this.sun = new T.DirectionalLight(0xffecd0, 1.25);
    this.sun.position.set(4, 12, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(512, 512);
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
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.distance = Math.max(ROWS * 1.65, (COLS * 1.48) / this.camera.aspect);
    this.camera.updateProjectionMatrix();
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
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.layers.set(f + 1);
    if (this.stage?.floors[f]?.dark && m.material.envMapIntensity !== undefined)
      m.material.envMapIntensity = 0;
    parent.add(m);
    return m;
  }
  box(x, y, z, w, h, d, mat, f, collider = true) {
    const m = this.mesh(new T.BoxGeometry(w, h, d), mat, x, y, z, f);
    if (collider)
      this.world.createCollider(
        this.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
          .setTranslation(x, y, z)
          .setFriction(0.35)
          .setRestitution(0.18)
      );
    return m;
  }
  load(stage, quest = true) {
    if (!this.ready) return;
    this.stopRecording();
    this.queue?.free();
    this.world?.free();
    while (this.board.children.length) {
      const o = this.board.children[0];
      o.traverse((n) => {
        n.geometry?.dispose();
        if (n.material) {
          n.material.map?.dispose();
          n.material.dispose();
        }
      });
      this.board.remove(o);
    }
    this.world = new this.R.World({ x: 0, y: -9.81, z: 0 });
    this.queue = new this.R.EventQueue(true);
    this.stage = stage;
    this.quest = quest;
    this.balls = [];
    this.enemies = [];
    this.doors = [];
    this.effects = [];
    this.ripples = [];
    this.lastRipple = -1;
    this.floorGroups = [];
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
    this.camera.position.set(0, this.distance, this.distance * 0.28);
    stage.floors.forEach((f, fi) => {
      const y = -fi * GAP;
      const group = new T.Group();
      this.board.add(group);
      this.floorGroups.push(group);
      const start = this.board.children.length;
      const blue = this.material(fi % 2 ? 0x126073 : 0x2578a2),
        wall = this.material(fi % 2 ? 0x45b5ac : 0x65c8ed);
      blue.opacity = 0.96;
      blue.transmission = 0.05;
      blue.roughness = 0.4;
      const screwMat = this.material(0x779ca4, false);
      for (let x = 0; x < COLS; x++)
        for (let z = 0; z < ROWS; z++) {
          const p = cellPos(x, z);
          if (!f.cells.some((c) => c.x === x && c.z === z && c.type === 'hole')) {
            this.box(p.x, y - 0.12, p.z, 0.99, 0.24, 0.99, blue, fi);
            const screw = this.mesh(
              new T.CylinderGeometry(0.035, 0.035, 0.012, 6),
              screwMat,
              p.x - 0.43,
              y + 0.009,
              p.z - 0.43,
              fi
            );
            screw.castShadow = false;
          }
        }
      for (const w of f.walls) {
        const p = cellPos(w.x, w.z);
        this.box(
          p.x + (w.axis === 'h' ? 0 : -0.5),
          y + 0.29,
          p.z + (w.axis === 'h' ? -0.5 : 0),
          w.axis === 'h' ? 1.08 : 0.12,
          0.58,
          w.axis === 'h' ? 0.12 : 1.08,
          wall,
          fi
        );
      }
      if (fi === 0) {
        const cover = this.box(0, y + 1.3, 0, COLS + 0.2, 0.07, ROWS + 0.2, this.material(0x9cdeea), fi);
        cover.material.opacity = 0.055;
        cover.material.transmission = 0;
        cover.castShadow = false;
      }
      for (const c of f.cells) {
        const p = cellPos(c.x, c.z);
        if (c.type === 'hole') {
          const ring = this.mesh(
            new T.TorusGeometry(0.42, 0.045, 6, 24),
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
          const beam = new T.SpotLight(0xbceeff, 1.6, depth + 1, 0.15, 0.4, 1);
          beam.position.set(p.x, y + 0.5, p.z);
          beam.target.position.set(p.x, y - depth, p.z);
          beam.layers.disableAll();
          for (let li = fi + 1; li <= bottom; li++) beam.layers.enable(li + 1);
          beam.userData.persistentLight = true;
          beam.target.userData.persistentLight = true;
          this.board.add(beam, beam.target);
          const glow = this.mesh(
            new T.CylinderGeometry(0.35, 0.43, depth, 4, 1, true),
            new T.MeshBasicMaterial({
              color: 0xb1e9f4,
              transparent: true,
              opacity: 0.035,
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
        if (c.type === 'goal') {
          const ring = this.mesh(
            new T.TorusGeometry(0.37, 0.07, 8, 32),
            this.material(0xb4f6c7, false),
            p.x,
            y + 0.05,
            p.z,
            fi
          );
          ring.rotation.x = Math.PI / 2;
          ring.material.emissive = new T.Color(0x47ae78);
          const disc = this.mesh(
            new T.CylinderGeometry(0.35, 0.35, 0.015, 24),
            new T.MeshBasicMaterial({ color: 0x79d6a4, transparent: true, opacity: 0.25 }),
            p.x,
            y + 0.02,
            p.z,
            fi
          );
          this.effects.push({ mesh: disc, type: 'goal' });
        }
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
        if (c.type === 'door') {
          const body = this.world.createRigidBody(
            this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, y + 0.32, p.z)
          );
          const vertical = (c.rotation || 0) % 2 === 1;
          this.world.createCollider(
            this.R.ColliderDesc.cuboid(vertical ? 0.065 : 0.5, 0.32, vertical ? 0.5 : 0.065),
            body
          );
          const mesh = this.box(
            p.x,
            y + 0.32,
            p.z,
            vertical ? 0.13 : 1,
            0.64,
            vertical ? 1 : 0.13,
            this.material(0xffa45a),
            fi,
            false
          );
          mesh.userData.dynamic = true;
          this.doors.push({ body, mesh, fi, c, y, open: false });
        }
        if (c.type === 'corner') {
          for (let j = 0; j < 7; j++) {
            const angle = ((j / 6) * Math.PI) / 2 + ((c.rotation || 0) * Math.PI) / 2;
            this.box(
              p.x + Math.cos(angle) * 0.38,
              y + 0.22,
              p.z + Math.sin(angle) * 0.38,
              0.17,
              0.44,
              0.17,
              wall,
              fi
            );
          }
        }
        if (['robot', 'spider', 'slime'].includes(c.type)) this.createEnemy(c, fi);
      }
      // Keep each floor independently visible during floor changes and replays.
      for (const child of this.board.children.slice(start))
        if (child !== group && !child.userData.persistentLight) group.add(child);
      this.batchFloor(group);
    });
    const radius = { S: 0.15, M: 0.22, L: 0.31 }[stage.size];
    stage.balls.forEach((p, i) => {
      const pos = cellPos(p.x, p.z),
        body = this.world.createRigidBody(
          this.R.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, radius + 0.1, pos.z)
            .setLinearDamping(0.18)
            .setAngularDamping(0.12)
            .setCcdEnabled(true)
        );
      const collider = this.world.createCollider(
        this.R.ColliderDesc.ball(radius)
          .setDensity({ S: 0.7, M: 1.4, L: 2 }[stage.size])
          .setFriction(0.45)
          .setRestitution(0.25)
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
      const mesh = this.mesh(
        new T.SphereGeometry(radius, 24, 16),
        mat,
        pos.x,
        radius + 0.1,
        pos.z,
        0
      );
      const light = new T.PointLight(['#ffbb77', '#b4f6c7', '#fff2b6'][i], 1.3, 2.2, 1.4);
      light.layers.set(1);
      mesh.add(light);
      this.balls.push({
        body,
        collider,
        mesh,
        light,
        radius,
        floor: 0,
        done: false,
        sticky: 0,
        prevSpeed: 0,
      });
    });
    this.sync();
    this.events.loaded?.();
  }
  start() {
    if (this.state !== 'ready') return;
    this.keys.clear();
    this.pointers.clear();
    this.acc = 0;
    this.last = performance.now();
    this.balls.forEach((b) => b.body.wakeUp());
    this.state = 'playing';
    this.startRecording();
  }
  batchFloor(group) {
    const buckets = new Map();
    for (const m of group.children)
      if (m.isMesh && !m.userData.dynamic && m.material) {
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
      this.target.z = clamp(this.target.z + dx * 0.006, -0.32, 0.32);
      this.target.x = clamp(this.target.x + dy * 0.006, -0.32, 0.32);
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
      this.target.x = clamp((e.beta - this.gyroBase.b) * 0.02, -0.32, 0.32);
      this.target.z = clamp((e.gamma - this.gyroBase.g) * 0.02, -0.32, 0.32);
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
        b.body.applyImpulse({ x: 0, y: b.body.mass() * 3.5, z: 0 }, true);
    }
    for (const e of this.enemies) e.stun = 1.4;
    this.sound.tone(0.6);
  }
  makeNoise(p, fi, power) {
    if (power < 0.25) return;
    this.noise = Math.max(this.noise, Math.min(1, power * 0.45));
    this.sound.tone(power);
    if (this.elapsed - this.lastRipple > 0.1) {
      this.lastRipple = this.elapsed;
      const mesh = this.mesh(
        new T.RingGeometry(0.15, 0.175, 24),
        new T.MeshBasicMaterial({
          color: 0xffc17c,
          transparent: true,
          opacity: 0.7,
          side: T.DoubleSide,
          depthWrite: false,
        }),
        p.x,
        -fi * GAP + 0.045,
        p.z,
        fi
      );
      mesh.rotation.x = -Math.PI / 2;
      this.ripples.push({ mesh, age: 0, power });
    }
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
    if (f.cells.some((c) => c.x === nx && c.z === nz && ['hole', 'corner'].includes(c.type)))
      return true;
    return this.doors.some((d) => d.fi === fi && !d.open && d.c.x === nx && d.c.z === nz);
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
        ((this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0)) * 0.3;
      this.target.x =
        ((this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0)) * 0.3;
    } else if (!this.pointers.size && !this.gyro) this.target = { x: 0, z: 0 };
    this.tilt.x += (this.target.x - this.tilt.x) * 0.12;
    this.tilt.z += (this.target.z - this.tilt.z) * 0.12;
    if (Math.hypot(old.x - this.tilt.x, old.z - this.tilt.z) / dt > 1.6)
      for (const e of this.enemies) e.stun = 1.4;
    this.world.gravity = {
      x: Math.sin(this.tilt.z) * 17,
      y: -Math.cos(this.tilt.x) * Math.cos(this.tilt.z) * 9.81,
      z: Math.sin(this.tilt.x) * 17,
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
      const ty = d.y + (d.open ? 1.02 : 0.32);
      d.body.setNextKinematicTranslation({ x: d.mesh.position.x, y: ty, z: d.mesh.position.z });
      d.mesh.position.y = ty;
    }
    if (Math.hypot(this.tilt.x, this.tilt.z) > 0.001)
      for (const b of this.balls) if (!b.done) b.body.wakeUp();
    this.world.timestep = dt;
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
    for (const b of this.balls) {
      if (b.done) continue;
      const p = b.body.translation(),
        v = b.body.linvel();
      b.prevSpeed = Math.hypot(v.x, v.y, v.z);
      if (Math.abs(p.x) > COLS / 2 + 0.5 || Math.abs(p.z) > ROWS / 2 + 0.5 || p.y < -this.stage.floors.length * GAP) {
        this.finish(false, '盤面の外に落ちました', b);
        return;
      }
      const nextFloor = clamp(
        Math.floor((-p.y + b.radius + 0.1) / GAP),
        0,
        this.stage.floors.length - 1
      );
      if (nextFloor > b.floor) {
        b.floor = nextFloor;
        b.mesh.layers.set(b.floor + 1);
        b.light.layers.set(b.floor + 1);
        b.mesh.material.envMapIntensity = this.stage.floors[b.floor].dark ? 0.015 : 0.22;
        if (this.quest) this.events.reached?.(b.floor + 1);
      }
      const f = this.stage.floors[b.floor];
      const near = f.cells.filter((c) => {
        const q = cellPos(c.x, c.z);
        return (
          Math.abs(q.x - p.x) < 0.44 && Math.abs(q.z - p.z) < 0.44 && p.y < -b.floor * GAP + 0.45
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
      if (near.some((c) => c.type === 'goal') && b.sticky <= 0) {
        b.done = true;
        b.body.setBodyType(this.R.RigidBodyType.Fixed, true);
        b.collider.setSensor(true);
        b.mesh.visible = false;
        b.light.intensity = 0;
        this.sound.tone(0.7, 'alert');
      }
    }
    this.updateEnemies(dt);
    if (this.state !== 'playing') return;
    this.activeFloor = Math.min(
      ...this.balls.filter((b) => !b.done).map((b) => b.floor),
      this.stage.floors.length - 1
    );
    this.viewFloor = this.activeFloor;
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
    for (const b of this.balls)
      b.mesh.visible = !(b.displayDone ?? b.done) && (b.displayFloor ?? b.floor) >= fi;
    this.floorGroups.forEach((g, i) => (g.visible = i >= fi));
    this.ambient.layers.disableAll();
    this.sun.layers.disableAll();
    for (let i = 0; i < this.stage.floors.length; i++)
      if (!this.stage.floors[i].dark) {
        this.ambient.layers.enable(i + 1);
        this.sun.layers.enable(i + 1);
      }
    this.sun.position.set(4 + this.tilt.z * 12, 12 - fi * GAP, 3 + this.tilt.x * 10);
    this.sunTarget.position.set(0, -fi * GAP, 0);
    this.board.rotation.set(this.tilt.x, 0, -this.tilt.z);
    const center = new T.Vector3(0, -fi * GAP, 0).applyEuler(this.board.rotation);
    this.camera.position.lerp(
      new T.Vector3(center.x, center.y + this.distance, center.z + this.distance * 0.28),
      0.1
    );
    this.camera.lookAt(center);
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
    for (const r of this.ripples) {
      r.age += dt;
      r.mesh.scale.setScalar(1 + r.age * 7);
      r.mesh.material.opacity = Math.max(0, 0.7 - r.age);
    }
    this.ripples = this.ripples.filter((r) => {
      if (r.age < 0.7) return true;
      this.board.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      return false;
    });
    this.setLighting();
    this.renderer.clear();
    // Three.js light layers select lights per camera, not per mesh. Render floors
    // separately so upper-floor sunlight never illuminates an unreached dark floor.
    for (let fi = this.stage.floors.length - 1; fi >= this.viewFloor; fi--) {
      this.camera.layers.set(fi + 1);
      this.renderer.render(this.scene, this.camera);
    }
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
      v[i++] = d.mesh.position.y;
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
    this.viewFloor = this.outcome.floor;
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
        b.light.layers.set(f + 1);
        b.displayFloor = f;
        b.displayDone = done;
        b.mesh.visible = !done;
        b.light.intensity = done ? 0 : 1.3;
      }
      for (const e of this.enemies) {
        e.g.position.x = v[i++];
        e.g.position.z = v[i++];
        e.g.rotation.y = v[i++];
        e.cone.visible = v[i++] <= 0;
        e.badge.visible = v[i++] > 0;
      }
      for (const d of this.doors) {
        d.mesh.position.y = v[i++];
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
        this.events.replayEnd?.(this.outcome);
      }
    }
  }
  startRecording() {
    if (!this.renderer.domElement.captureStream || !window.MediaRecorder) {
      this.events.video?.(null);
      return;
    }
    try {
      const stream = this.renderer.domElement.captureStream(30);
      const mime = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
        MediaRecorder.isTypeSupported(t)
      );
      const recorder = new MediaRecorder(
          stream,
          mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : {}
        ),
        chunks = [];
      this.recorder = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (this.recorder !== recorder) return;
        this.recordedBlob = new Blob(chunks, { type: recorder.mimeType });
        this.events.video?.(this.recordedBlob);
      };
      recorder.onerror = () => this.events.video?.(null);
      recorder.start(1000);
    } catch {
      this.events.video?.(null);
    }
  }
  stopRecording() {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }
}
