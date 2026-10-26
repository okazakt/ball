import { QUESTS, questStage } from './quests.js';
import { keepScreenAwake } from './wake-lock.js';
import { VERSION } from './version.js';
import { Game } from './game.js';
import { Sound } from './audio.js';
import { Editor } from './editor.js';
import { decodeStage, stageURL, validateStage } from './stage.js';
import * as store from './storage.js';
const $ = (s) => document.querySelector(s);
keepScreenAwake();
const displayVersion = VERSION.split('+')[0];
$('#app-version').textContent = `v${displayVersion}`;
$('#menu-version').textContent = `表示中のバージョン：v${displayVersion}`;
let toastTimer,
  stage = questStage(0),
  questIndex = 0,
  lastResult;
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
    $('#video').textContent = 'リプレイから動画を作る';
    $('#qr').hidden = true;
    $('#status').textContent = game.quest ? QUESTS[questIndex].hint : '開始ボタンでスタート';
    $('#start-panel').hidden = false;
    updateViewControls();
  },
  frame(g) {
    if (g.state === 'playing')
      $('#status').textContent = g.balls.some((b) => b.sticky > 0)
        ? '磁力ネット！ シェイク連打で脱出'
        : g.enemies.some((e) => e.state === 'chase')
        ? '見つかった！ 追跡から逃げよう'
        : g.noise > 0.6
        ? '大きな音！ 敵が調べに来ます'
        : g.balls.some(b => !b.done && b.floor === 1) ? (g.cameraMode==='tilt'?'下段の玉を、坂道へ。盤の傾きを3D表示中。':'下段の玉を、坂道へ。視点は上段に固定。') : '静かに、光の先へ。';
    $('#timer').textContent = g.elapsed.toFixed(2).padStart(6, '0');
    $('#balls-status').textContent = g.balls.map((b) => (b.done ? '○' : '●')).join(' ');
    $('#noise').textContent =
      'NOISE ' + Array.from({ length: 5 }, (_, i) => (i < g.noise * 5 ? '▰' : '░')).join('');
    updateViewControls();
    $('#floor-status').textContent = g.cameraMode==='tilt'?'上段・下段 · 3D表示':g.balls.some(b => !b.done && b.floor === 1) ? '下段の玉を操作中 · 視点は上段' : '上段・下段';
    $('#tilt-indicator i').style.transform = `translate(${g.tilt.z * 30}px,${g.tilt.x * 30}px)`;
  },
  status(t) {
    $('#status').textContent = t;
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
    $('#status').textContent = 'リプレイ再生中 · ビューを切り替えて確認できます';
  },
  replayEnd(r) {
    $('#replay-label').hidden = true;
    showResult(r);
  },
  viewChanged() {
    updateViewControls();
    $('#video').disabled=!game.canExportVideo()||game.logCount<2||!!game.exportingVideo;
    $('#video').textContent=game.canExportVideo()?'リプレイから動画を作る':'このブラウザは動画出力非対応';
  },
  video(blob) {
    $('#video').disabled = !blob;
    $('#video').textContent = blob ? '動画を保存 / 共有' : 'このブラウザは録画非対応';
  },
});
function updateViewControls() {
  const selector=$('#view-mode');
  if(selector.value!==game.cameraMode)selector.value=game.cameraMode;
  selector.disabled=!!game.exportingVideo;
  $('#floor-label').innerHTML=game.cameraMode==='tilt'
    ? '盤の傾き3D <span>CAMERA FIXED</span>' : '上段 <span>FIXED VIEW</span>';
}
$('#view-mode').onchange=e=>{
  if(!game.setCameraMode(e.target.value))toast('動画出力が終わってからビューを切り替えてください');
  updateViewControls();
};
function showResult(r) {
  $('#next-quest').hidden = !r.won || !game.quest || questIndex >= QUESTS.length-1;
  $('#result-tag').textContent = r.won ? 'MISSION COMPLETE' : 'SIGNAL LOST';
  $('#result-title').textContent = r.won ? '光の先に、到着。' : 'もう一度、そっと。';
  $('#result-detail').textContent = `${r.reason} · ${r.time.toFixed(2)}秒`;
  $('#video').disabled = !game.canExportVideo() || game.logCount < 2 || !!game.exportingVideo;
  $('#video').textContent = game.exportingVideo ? '動画を仕上げています…'
    : game.recordedBlob ? '動画を保存 / 共有' : game.canExportVideo() ? 'リプレイから動画を作る' : 'このブラウザは動画出力非対応';
  if (!$('#result').open) $('#result').showModal();
}
async function play(s, quest = false) {
  clearTimeout(game.autoReplay);
  let valid;
  try { valid = validateStage(s); }
  catch (error) { toast(error.message); return; }
  closeDialogs();
  stage = valid;
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
$('#quest').onclick = () => { closeDialogs(); $('#quest-dialog').showModal(); };
for (const [index, quest] of QUESTS.entries()) {
  const button=document.createElement('button'); button.textContent=quest.name;
  button.onclick=()=>{questIndex=index;play(questStage(index),true);};
  $('#quest-list').append(button);
}
$('#next-quest').onclick=()=>{questIndex++;play(questStage(questIndex),true);};
$('#edit').onclick = () => {
  closeDialogs();
  editor.open(stage);
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
  if (!blob) {
    if (!game.exportReplayVideo()) toast('動画を作成できませんでした');
    else toast('リプレイを再生して動画を作成します');
    return;
  }
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
      p.textContent = `@${item.stage.author} · 上下2段`;
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
$('#storage-note').textContent = store.persistent
  ? '履歴は最新50件。お気に入りは自動削除されません。'
  : '一時保存モード：このブラウザでは永続保存が使えません。';
try {
  await game.init();
  if (location.hash.startsWith('#stage=')) {
    try {
      stage = decodeStage(location.href);
    } catch (e) {
      toast(e.message);
    }
  }
  await play(stage, !location.hash.startsWith('#stage='));
  $('#loading').remove();
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
