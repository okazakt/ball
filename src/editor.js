import { footprint, doorSpec, goalEdge } from './mechanics.js';
import { COLS, ROWS, clone, validateStage, wallKey } from './stage.js';
const labels = {
  wall: '直線壁',
  corner: '曲面壁',
  erase: '消しゴム',
  ball: 'ボール初期位置',
  hole: '穴',
  goal: '側面出口（外向き）',
  sticky: '粘着床',
  door: '昇降ドア（1マス・選択辺）',
  ramp: '坂道（2マス）',
  switch: 'スイッチ',
  robot: 'ロボット',
  spider: '蜘蛛',
  slime: 'ゼリー',
};
const colors = {
  hole: '#050a0e',
  goal: '#ef334b',
  sticky: '#b068cc',
  door: '#64bd8f',
  ramp: '#9ee3c4',
  switch: '#f5dc97',
  robot: '#fa8b6a',
  spider: '#dd939b',
  slime: '#929fe6',
  corner: '#72c5dd',
  ball: '#f5cc83',
};
export class Editor {
  constructor(onPlay, toast) {
    this.onPlay = onPlay;
    this.toast = toast;
    this.dialog = document.querySelector('#editor');
    this.canvas = document.querySelector('#grid');
    this.canvas.width = COLS * 60;
    this.canvas.height = ROWS * 60;
    this.ctx = this.canvas.getContext('2d');
    this.tool = 'wall';
    this.rotation = 0;
    this.fi = 0;
    this.undo = [];
    this.redo = [];
    this.drawing = false;
    const tools = document.querySelector('#tools');
    for (const [key, label] of Object.entries(labels)) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.tool = key;
      b.onclick = () => {
        this.tool = key;
        this.updateTools();
      };
      tools.append(b);
    }
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.undo.push(clone(this.stage));
      if (this.undo.length > 100) this.undo.shift();
      this.redo = [];
      this.touched = new Set();
      this.lastPaint = { x: e.clientX, y: e.clientY };
      this.paint(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drawing) {
        const a = this.lastPaint,
          n = Math.ceil(Math.hypot(e.clientX - a.x, e.clientY - a.y) / 6);
        for (let i = 1; i <= n; i++)
          this.paint({
            clientX: a.x + ((e.clientX - a.x) * i) / n,
            clientY: a.y + ((e.clientY - a.y) * i) / n,
          });
        this.lastPaint = { x: e.clientX, y: e.clientY };
      }
    });
    for (const ev of ['pointerup', 'pointercancel'])
      this.canvas.addEventListener(ev, () => {
        this.drawing = false;
        this.draw();
      });
    document.querySelector('#rotate').onclick = () => {
      this.rotation = (this.rotation + 1) % 4;
      this.updateTools();
    };
    document.querySelector('#undo').onclick = () => this.history('undo', 'redo');
    document.querySelector('#redo').onclick = () => this.history('redo', 'undo');
    document.querySelector('#edit-floor').onchange = (e) => {
      this.fi = Number(e.target.value);
      if(this.fi===1&&this.tool==='door')this.tool='wall';
      this.draw();
    };
    document.querySelector('#dark-floor').onclick = () => {
      this.snapshot();
      this.stage.floors[this.fi].dark = !this.stage.floors[this.fi].dark;
      this.draw();
    };
    for (const [id, key] of [
      ['edit-name', 'name'],
      ['edit-author', 'author'],
      ['edit-limit', 'limit'],
      ['ball-size', 'size'],
    ])
      document.getElementById(id).onchange = (e) => {
        this.snapshot();
        this.stage[key] = key === 'limit' ? Number(e.target.value) : e.target.value;
        this.draw();
      };
    document.querySelector('#test-stage').onclick = () => {
      try {
        const valid = validateStage(this.stage);
        this.dialog.close();
        this.onPlay(valid);
      } catch (e) {
        this.toast(e.message);
      }
    };
  }
  open(stage) {
    this.stage = clone(stage);
    this.fi = 0;
    this.undo = [];
    this.redo = [];
    this.draw();
    this.dialog.showModal();
  }
  snapshot() {
    this.undo.push(clone(this.stage));
    this.redo = [];
  }
  history(from, to) {
    if (!this[from].length) return;
    this[to].push(clone(this.stage));
    this.stage = this[from].pop();
    this.fi = Math.min(this.fi, this.stage.floors.length - 1);
    this.draw();
  }
  updateTools() {
    document
      .querySelectorAll('[data-tool]')
      .forEach((b) => { b.classList.toggle('selected', b.dataset.tool === this.tool); b.disabled=this.fi===1&&b.dataset.tool==='door'; });
    document.querySelector('#rotate').textContent = `↻ ${this.rotation * 90}°`;
  }
  paint(e) {
    const r = this.canvas.getBoundingClientRect(),
      gx = ((e.clientX - r.left) / r.width) * COLS,
      gz = ((e.clientY - r.top) / r.height) * ROWS,
      x = Math.max(0, Math.min(COLS - 1, Math.floor(gx))),
      z = Math.max(0, Math.min(ROWS - 1, Math.floor(gz)));
    const f = this.stage.floors[this.fi],
      edge =
        Math.min(gx % 1, 1 - (gx % 1)) < Math.min(gz % 1, 1 - (gz % 1))
          ? { axis: 'v', x: Math.round(gx), z }
          : { axis: 'h', x, z: Math.round(gz) };
    if (
      edge.x < 0 ||
      edge.z < 0 ||
      edge.x > (edge.axis === 'h' ? COLS - 1 : COLS) ||
      edge.z > (edge.axis === 'h' ? ROWS : ROWS - 1)
    )
      return;
    const edgeMode =
      this.tool === 'wall' ||
      (this.tool === 'erase' && Math.min(gx % 1, 1 - (gx % 1), gz % 1, 1 - (gz % 1)) < 0.22);
    const key = edgeMode ? wallKey(edge.axis, edge.x, edge.z) : `${x}:${z}`;
    if (this.touched.has(key)) return;
    this.touched.add(key);
    const candidate = clone(this.stage), layer = candidate.floors[this.fi];
    if (edgeMode) {
      const i = layer.walls.findIndex(w => wallKey(w.axis,w.x,w.z) === key);
      if (this.tool === 'erase') { if (i >= 0) layer.walls.splice(i,1); }
      else if (i < 0) layer.walls.push(edge);
    } else if (this.tool === 'erase') {
      candidate.floors.forEach((floor,owner) => {
        floor.cells = floor.cells.filter(c => {
          const visible = owner === this.fi || (owner === 0 && this.fi === 1 && ['ramp','door'].includes(c.type));
          return !visible || !footprint(c).some(p => p.x === x && p.z === z);
        });
      });
      candidate.balls = candidate.balls.filter(b => (b.floor ?? 0) !== this.fi || b.x !== x || b.z !== z);
    } else if (this.tool === 'ball') {
      if (candidate.balls.length >= 3) { this.toast('玉は最大3個です。消しゴムで移動できます'); return; }
      candidate.balls.push({ x,z,floor:this.fi });
    } else {
      if (this.tool === 'goal') candidate.floors.forEach(f => { f.cells = f.cells.filter(c => c.type !== 'goal'); });
      const owner = this.tool === 'ramp' ? 0 : this.fi;
      candidate.floors[owner].cells.push({ x,z,type:this.tool,rotation:this.rotation,
        rule: this.tool === 'slime' ? 'random' : this.rotation % 2 ? 'left' : 'right' });
    }
    try { validateStage(candidate, { allowIncomplete: true }); }
    catch (error) { this.conflict(x,z,error.message); return; }
    this.stage = candidate;
    this.draw();
  }
  conflict(x, z, message = '共存できない素材があります') {
    this.toast(message);
    this.flash = { x, z };
    let n = 0;
    const blink = () => {
      this.draw();
      if (n++ < 6) {
        this.ctx.fillStyle = n % 2 ? '#ff665b99' : '#ffffff88';
        this.ctx.fillRect(x * 60 + 2, z * 60 + 2, 56, 56);
        setTimeout(blink, 100);
      } else this.flash = null;
    };
    blink();
  }
  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, COLS * 60, ROWS * 60);
    c.fillStyle = this.stage.floors[this.fi].dark ? '#09121d' : '#163443';
    c.fillRect(0, 0, COLS * 60, ROWS * 60);
    c.strokeStyle = '#294552';
    c.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      c.beginPath();
      c.moveTo(x * 60, 0);
      c.lineTo(x * 60, ROWS * 60);
      c.stroke();
    }
    for (let z = 0; z <= ROWS; z++) {
      c.beginPath();
      c.moveTo(0, z * 60);
      c.lineTo(COLS * 60, z * 60);
      c.stroke();
    }
    const materials = [...this.stage.floors[this.fi].cells];
    if (this.fi === 1) materials.push(...this.stage.floors[0].cells.filter(c => ['ramp','door'].includes(c.type)).map(c => ({ ...c, lowerView: true })));
    for (const t of materials) {
      const cells = footprint(t), x = Math.min(...cells.map(c => c.x))*60, z = Math.min(...cells.map(c => c.z))*60;
      const width = (Math.max(...cells.map(c => c.x))-Math.min(...cells.map(c => c.x))+1)*60;
      const height = (Math.max(...cells.map(c => c.z))-Math.min(...cells.map(c => c.z))+1)*60;
      c.fillStyle = t.lowerView && t.type === 'door' ? '#4b756b' : colors[t.type];
      c.fillRect(x+8,z+8,width-16,height-16);
      if(t.type==='door'){const d=doorSpec(t,0);c.fillStyle='#16352b';
        c.fillRect((d.x+COLS/2-d.halfX)*60,(d.z+ROWS/2-d.halfZ)*60,d.halfX*120,d.halfZ*120);}
      c.fillStyle = '#10232f'; c.font = '10px sans-serif'; c.textAlign = 'center';
      c.fillText(t.lowerView && t.type === 'door' ? '昇降・支柱' : t.type === 'door' ? '昇降ドア' : t.type === 'ramp' ? '坂道' : labels[t.type], x+width/2,z+height/2);
      if (cells.length === 2 || t.rotation || t.type === 'door' || t.type === 'goal') c.fillText(['↓','→','↑','←'][t.rotation ?? 0],x+width/2,z+height/2+15);
    }
    for (const b of this.stage.balls) if ((b.floor ?? 0) === this.fi) {
      c.fillStyle = colors.ball; c.beginPath(); c.arc(b.x*60+30,b.z*60+30,11,0,Math.PI*2); c.fill();
    }
    c.strokeStyle = '#7cdaec';
    c.lineWidth = 5;
    for (const w of this.stage.floors[this.fi].walls) {
      c.beginPath();
      c.moveTo(w.x * 60, w.z * 60);
      c.lineTo((w.x + (w.axis === 'h' ? 1 : 0)) * 60, (w.z + (w.axis === 'v' ? 1 : 0)) * 60);
      c.stroke();
    }
    for (const t of materials.filter(t => t.type === 'goal')) {
      const e = goalEdge(t); if (!e) continue;
      for (let i=0;i<10;i++) {
        c.strokeStyle = i%2 ? '#ffffff' : '#ef334b'; c.lineWidth = 8;
        c.beginPath(); c.moveTo(e.x*60+(e.axis==='h'?i*6:0),e.z*60+(e.axis==='v'?i*6:0));
        c.lineTo(e.x*60+(e.axis==='h'?(i+1)*6:0),e.z*60+(e.axis==='v'?(i+1)*6:0)); c.stroke();
      }
    }
    const select = document.querySelector('#edit-floor');
    select.replaceChildren(...this.stage.floors.map((_, i) => new Option(i === 0 ? '上段' : '下段', i)));
    select.value = this.fi;
    document.querySelector('#dark-floor').textContent = `暗闇 ${
      this.stage.floors[this.fi].dark ? 'ON' : 'OFF'
    }`;
    for (const [id, key] of [
      ['edit-name', 'name'],
      ['edit-author', 'author'],
      ['edit-limit', 'limit'],
      ['ball-size', 'size'],
    ])
      document.getElementById(id).value = this.stage[key];
    document.querySelector('#undo').disabled = !this.undo.length;
    document.querySelector('#redo').disabled = !this.redo.length;
    this.updateTools();
  }
}
