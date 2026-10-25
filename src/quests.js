import { floor, validateStage, COLS, ROWS, clone } from './stage.js';
import { sharedEdge } from './mechanics.js';
import { QUEST_LAYOUTS } from './quest-layouts.js';

export const QUESTS = [
  {name:'1 はじめの迷路', hint:'上段だけの迷路。2つの行き止まりを見分けて、右下のゴールへ。'},
  {name:'2 曲がり角の落とし穴', hint:'曲がり角では減速。落ちたら左上付近の坂道へ。半透明の床から下段を確認できます。'},
  {name:'3 穴の先の道', hint:'前半の終点の穴から下段へ。坂道を上ると後半の道が始まります。'},
  {name:'4 迫る警備ロボット', hint:'行き止まりの奥から警備ロボットが接近。道をふさがれる前に進もう。'},
];

// Only passages in the generated graph are open. Every tile is assigned to a
// corridor; stage 3 deliberately separates the two upper regions by a descent.
function maze(edges) {
  const upper=floor(), open=new Set();
  for (const [a,b] of edges) {
    const edge=sharedEdge({x:a%COLS,z:Math.floor(a/COLS)},{x:b%COLS,z:Math.floor(b/COLS)});
    open.add(`${edge.axis}:${edge.x}:${edge.z}`);
  }
  for(let z=1;z<ROWS;z++) for(let x=0;x<COLS;x++)
    if(!open.has(`h:${x}:${z}`)) upper.walls.push({axis:'h',x,z});
  for(let x=1;x<COLS;x++) for(let z=0;z<ROWS;z++)
    if(!open.has(`v:${x}:${z}`)) upper.walls.push({axis:'v',x,z});
  return upper;
}

export function questStage(index=0) {
  if(!QUESTS[index]) throw Error('クエストがありません');
  const layout=QUEST_LAYOUTS[index],upper=maze(layout.edges);
  upper.cells=clone(layout.cells);
  if(layout.windows) upper.windows=clone(layout.windows);
  upper.cells.push({type:'goal',x:7,z:10,rotation:1});
  upper.walls=upper.walls.filter(w=>!(w.axis==='v'&&w.x===COLS&&w.z===10));
  return validateStage({version:1,...QUESTS[index],author:'marble_lab',limit:300,size:'M',
    balls:[{x:0,z:0}],floors:[upper,floor()]});
}
