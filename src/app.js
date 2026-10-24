import { VERSION } from './version.js';
import { Game } from './game.js';
import { Sound } from './audio.js';
import { Editor } from './editor.js';
import { defaultStage, decodeStage, stageURL } from './stage.js';
import * as store from './storage.js';
const $ = (s) => document.querySelector(s);
const displayVersion = VERSION.split('+')[0];
$('#app-version').textContent = `v${displayVersion}`;
$('#menu-version').textContent = `表示中のバージョン：v${displayVersion}`;
let toastTimer,
  stage = defaultStage(),
  lastResult,
  unlocked = 1;
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}
function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}
const sound = new Sound();
const game = new Game($('#viewport'), sound, {
  loaded() {
    $('#stage-name').textContent = stage.name;
    $('#creator').textContent = '@' + stage.author;
    $('#limit').textContent = ` / ${stage.limit}s`;
    $('#replay-label').hidden = true;
    $('#video').disabled = true;
    $('#video').textContent = '録画を準備中…';
    $('#qr').hidden = true;
    $('#status').textContent = '開始ボタンでスタート';
    $('#start-panel').hidden = false;
  },
  frame(g) {
    if (g.state === 'playing')
      $('#status').textContent = g.balls.some((b) => b.sticky > 0)
        ? '磁力ネット！ シェイク連打で脱出'
        : g.enemies.some((e) => e.state === 'chase')
        ? '見つかった！ 追跡から逃げよう'
        : g.noise > 0.6
        ? '大きな音！ 敵が調べに来ます'
        : '静かに、光の先へ。';
    $('#timer').textContent = g.elapsed.toFixed(2).padStart(6, '0');
    $('#balls-status').textContent = g.balls.map((b) => (b.done ? '○' : '●')).join(' ');
    $('#noise').textContent =
      'NOISE ' + Array.from({ length: 5 }, (_, i) => (i < g.noise * 5 ? '▰' : '░')).join('');
    $('#floor-label').innerHTML = `B${g.viewFloor + 1} <span>${
      stage.floors[g.viewFloor]?.dark ? 'DARK SECTOR' : 'LIGHT WELL'
    }</span>`;
    $('#floor-status').textContent = `B${g.viewFloor + 1} / B${stage.floors.length}`;
    $('#tilt-indicator i').style.transform = `translate(${g.tilt.z * 30}px,${g.tilt.x * 30}px)`;
  },
  status(t) {
    $('#status').textContent = t;
  },
  reached(n) {
    unlocked = Math.max(unlocked, n);
    store.unlock(n).catch(() => toast('進行状況を保存できませんでした'));
  },
  finished(result, log) {
    lastResult = result;
    store
      .saveReplay({ stage, result, ...log })
      .catch(() => toast('リプレイを保存できませんでした'));
    showResult(result);
  },
  replaying() {
    $('#start-panel').hidden = true;
    closeDialogs();
    $('#replay-label').hidden = false;
    $('#status').textContent = '玉の光だけで、直前の出来事を振り返る';
  },
  replayEnd(r) {
    $('#replay-label').hidden = true;
    showResult(r);
  },
  video(blob) {
    $('#video').disabled = !blob;
    $('#video').textContent = blob ? '録画を保存 / 共有' : 'このブラウザは録画非対応';
  },
});
const wallPanel = document.createElement('details');
wallPanel.id = 'wall-controls';
const wallSummary = document.createElement('summary');
wallSummary.textContent = '壁マテリアル調整';
wallPanel.append(wallSummary);
const wallFields = document.createElement('div');
wallFields.className = 'wall-fields';
for (const [key, title, min, max] of [
  ['edgeWidth', '白帯の幅比率 / edgeWidth', 0.05, 0.5],
  ['edgeBrightness', '両フチの輝度 / edgeBrightness', 0, 5],
  ['sideGloss', '側面のツヤ / sideGloss', 0, 3],
  ['bottomEdge', '根元の接地帯 / bottomEdge', 0, 1],
  ['centerOpacity', '中央の不透明度 / centerOpacity', 0, 0.5],
  ['taperAngle', '抜き勾配 / taperAngle', 0, 0.8],
  ['cornerRadius', '先端・角の丸み / cornerRadius', 0, 1],
  ['lightAngle', '光源の角度 / lightAngle', 0, 3.14],
  ['specularSharpness', '光の鋭さ / specularSharpness', 1, 20],
  ['resinTint', '樹脂の色味・ミルク感 / resinTint', 0, 1],
  ['topFusion', '天井との結合部 / topFusion', 0, 1],
  ['bottomFusion', '床との接着・結合部 / bottomFusion', 0, 1],
  ['resinDensity', '樹脂の内部密度 / resinDensity', 0, 1],
  ['wallThickness', '壁の厚み・ボリューム / wallThickness', 0.5, 2],
]) {
  const label = document.createElement('label');
  label.htmlFor = `wall-${key}`;
  const caption = document.createElement('span');
  caption.textContent = title;
  const output = document.createElement('output');
  output.htmlFor = `wall-${key}`;
  const input = document.createElement('input');
  Object.assign(input, { id: `wall-${key}`, type: 'range', min, max, step: 0.01,
    value: game.wallSettings[key] });
  output.value = Number(input.value).toFixed(2);
  input.addEventListener('input', () => {
    output.value = Number(input.value).toFixed(2);
    game.updateWallSettings({ [key]: Number(input.value) });
  });
  label.append(caption, output, input);
  wallFields.append(label);
}
// Keep native range gestures and keyboard controls, without tilting the board.
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
  'touchstart', 'touchmove', 'touchend', 'click', 'dblclick', 'keydown'])
  wallPanel.addEventListener(type, event => event.stopPropagation());
wallPanel.append(wallFields);
$('#viewport').append(wallPanel);

function showResult(r) {
  $('#result-tag').textContent = r.won ? 'MISSION COMPLETE' : 'SIGNAL LOST';
  $('#result-title').textContent = r.won ? '光の先に、到着。' : 'もう一度、そっと。';
  $('#result-detail').textContent = `${r.reason} · ${r.time.toFixed(2)}秒`;
  if (!$('#result').open) $('#result').showModal();
}
async function play(s, quest = false) {
  clearTimeout(game.autoReplay);
  closeDialogs();
  stage = s;
  game.load(stage, quest);
  store.saveStage(stage).catch(() => toast('ステージの履歴を保存できませんでした'));
}
function startGame() {
  sound.start().catch(() => {});
  game.start();
  $('#start-panel').hidden = true;
  $('#sound').textContent = '音をOFFにする';
}
$('#start').onclick = startGame;
$('#start-gyro').onclick = async () => {
  try {
    await game.enableGyro();
    startGame();
    toast('現在の角度を基準にしました');
  } catch (e) {
    toast(e.message + '。ドラッグ / キー操作でも開始できます');
  }
};
const editor = new Editor((s) => play(s), toast);
$('#menu').onclick = () => {
  game.keys.clear();
  game.pointers.clear();
  game.target = { x: 0, z: 0 };
  $('#menu-dialog').showModal();
};
$('#jump').onclick = () => {
  sound.start().catch(() => {});
  game.jump();
};
$('#retry').onclick = () => play(stage, game.quest);
$('#again').onclick = () => play(stage, game.quest);
$('#result-menu').onclick = () => {
  closeDialogs();
  $('#menu-dialog').showModal();
};
$('#replay').onclick = () => game.playReplay();
$('#gyro').onclick = async () => {
  try {
    if (game.gyro) {
      game.gyro = false;
      game.target = { x: 0, z: 0 };
      toast('ドラッグ操作に戻しました');
      return;
    }
    await game.enableGyro();
    toast('現在の角度を基準にしました');
  } catch (e) {
    toast(e.message);
  }
};
$('#quest').onclick = () => play(defaultStage(), true);
$('#edit').onclick = () => {
  closeDialogs();
  editor.open(stage, unlocked);
};
$('#sound').onclick = async () => {
  try {
    if (!sound.ctx) await sound.start();
    else sound.toggle();
    $('#sound').textContent = sound.enabled ? '音をOFFにする' : '音をONにする';
  } catch {
    toast('音声を開始できません');
  }
};
$('#copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(stageURL(stage));
    toast('ステージURLをコピーしました。PWAで「コピー受入」');
  } catch {
    const text = prompt('このURLをコピーしてください', stageURL(stage));
    if (text) toast('URLを保存して共有できます');
  }
};
$('#qr-button').onclick = () => {
  const host = $('#qr');
  if (!host.hidden) {
    host.hidden = true;
    return;
  }
  host.replaceChildren();
  try {
    new window.QRCode(host, {
      text: stageURL(stage),
      width: 240,
      height: 240,
      correctLevel: window.QRCode.CorrectLevel.L,
    });
    host.hidden = false;
  } catch {
    toast('このステージはQR容量を超えています。URLコピーで共有してください');
  }
};
async function importText(text) {
  try {
    await play(decodeStage(text));
    toast('ステージを受け取りました');
  } catch (e) {
    toast(e.message);
  }
}
$('#paste').onclick = async () => {
  try {
    await importText(await navigator.clipboard.readText());
  } catch {
    const t = prompt('コピーしたステージURLをペースト');
    if (t) await importText(t);
  }
};
$('#favorite').onclick = () =>
  store
    .saveStage(stage, true)
    .then(() => toast('お気に入りに保存しました'))
    .catch(() => toast('保存できませんでした'));
$('#video').onclick = async () => {
  const blob = game.recordedBlob;
  if (!blob) return;
  const file = new File(
    [blob],
    `toukan-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`,
    { type: blob.type }
  );
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: stage.name });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
async function showLibrary() {
  try {
    const all = await store.listStages();
    const host = $('#library-list');
    host.replaceChildren();
    if (!all.length) host.textContent = 'まだ履歴がありません';
    for (const item of all.sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || b.time - a.time
    )) {
      const article = document.createElement('article'),
        title = document.createElement('strong'),
        p = document.createElement('p');
      title.textContent = (item.favorite ? '★ ' : '') + item.stage.name;
      p.textContent = `@${item.stage.author} · ${item.stage.floors.length}階層`;
      article.append(title, p);
      for (const [label, action] of [
        ['遊ぶ', () => play(item.stage)],
        [
          item.favorite ? '★ 解除' : '☆ 保護',
          async () => {
            await store.toggleFavorite(item);
            showLibrary();
          },
        ],
        [
          '削除',
          async () => {
            await store.removeStage(item.id);
            showLibrary();
          },
        ],
      ]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = () => Promise.resolve(action()).catch(() => toast('保存操作に失敗しました'));
        article.append(b);
      }
      host.append(article);
    }
    closeDialogs();
    $('#library').showModal();
  } catch {
    toast('履歴を読み込めません');
  }
}
$('#history').onclick = showLibrary;
$('#saved-replay').onclick = async () => {
  try {
    const saved = await store.getReplay();
    if (!saved) {
      toast('保存されたリプレイがありません');
      return;
    }
    stage = saved.stage;
    lastResult = saved.result;
    game.playSavedReplay(saved);
  } catch (e) {
    toast('リプレイを開けません：' + e.message);
  }
};
let installEvent;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('#install').hidden = false;
});
$('#install').onclick = async () => {
  await installEvent?.prompt();
  installEvent = null;
  $('#install').hidden = true;
};
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#stage=')) importText(location.href);
});
// Clipboard access is attempted only when a standalone app gains focus and permission was granted.
window.addEventListener('focus', async () => {
  if (!matchMedia('(display-mode: standalone)').matches || !game.ready) return;
  try {
    const p = await navigator.permissions.query({ name: 'clipboard-read' });
    if (p.state === 'granted') {
      const t = await navigator.clipboard.readText();
      if (t.includes('#stage=') && t !== stageURL(stage))
        toast('ステージを検知しました。メニューの「コピー受入」で開けます');
    }
  } catch {}
});
await store.openStorage();
unlocked = await store.getUnlocked();
$('#storage-note').textContent = store.persistent
  ? '履歴は最新50件。お気に入りは自動削除されません。'
  : '一時保存モード：このブラウザでは永続保存が使えません。';
try {
  await game.init();
  $('#loading').remove();
  if (location.hash.startsWith('#stage=')) {
    try {
      stage = decodeStage(location.href);
    } catch (e) {
      toast(e.message);
    }
  }
  await play(stage, !location.hash.startsWith('#stage='));
} catch (e) {
  console.error(e);
  $('#loading').replaceChildren();
  const p = document.createElement('p');
  p.textContent =
    '3Dエンジンを起動できません。WebGL対応ブラウザで開き、vendor/rapier.es.js が配置されているか確認してください。';
  const b = document.createElement('button');
  b.textContent = '再読み込み';
  b.onclick = () => location.reload();
  $('#loading').append(p, b);
}
if ('serviceWorker' in navigator)
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((registration) => {
      const check = () => registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
      return registration;
    })
    .catch(() => toast('オフライン保存はHTTPSまたはlocalhostで利用できます'));
// Read-only diagnostics for browser integration checks.
window.__toukan = { game, editor, store };
