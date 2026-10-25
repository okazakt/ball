import { floor, validateStage, COLS, ROWS } from './stage.js';
import { sharedEdge } from './mechanics.js';

// Explicit corridor graphs keep shortcuts closed and make new quests easy to add.
function maze(paths) {
  const f = floor(), openings = new Set();
  for (const points of paths) for (let i=1;i<points.length;i++) {
    let [x,z]=points[i-1]; const [tx,tz]=points[i];
    if (x!==tx && z!==tz) throw Error('Corridors must be orthogonal');
    while(x!==tx || z!==tz) {
      const nx=x+Math.sign(tx-x), nz=z+Math.sign(tz-z), e=sharedEdge({x,z},{x:nx,z:nz});
      openings.add(`${e.axis}:${e.x}:${e.z}`); x=nx;z=nz;
    }
  }
  for(let z=1;z<ROWS;z++) for(let x=0;x<COLS;x++)
    if(!openings.has(`h:${x}:${z}`)) f.walls.push({axis:'h',x,z});
  for(let x=1;x<COLS;x++) for(let z=0;z<ROWS;z++)
    if(!openings.has(`v:${x}:${z}`)) f.walls.push({axis:'v',x,z});
  return f;
}
const winding = [[0,0],[7,0],[7,2],[1,2],[1,4],[6,4],[6,6],[1,6],[1,8],[7,8],[7,10]];
const branches = [[[4,0],[4,1]], [[4,6],[4,7],[3,7]]];
export const QUESTS = [
  {name:'1 はじめの迷路', hint:'上段だけの迷路。2つの行き止まりを見分けて、右下のゴールへ。'},
  {name:'2 曲がり角の落とし穴', hint:'曲がり角では減速。落ちたら左上付近の坂道へ。半透明の床から下段を確認できます。'},
  {name:'3 穴の先の道', hint:'前半の終点の穴から下段へ。坂道を上ると後半の道が始まります。'},
  {name:'4 迫る警備ロボット', hint:'行き止まりの奥から警備ロボットが接近。道をふさがれる前に進もう。'},
];
export function questStage(index=0) {
  if(!QUESTS[index]) throw Error('クエストがありません');
  let upper;
  if(index===0 || index===3) upper=maze([winding,...branches]);
  if(index===1) {
    upper=maze([[[0,0],[5,0],[5,3],[2,3],[2,6],[6,6],[6,8],[3,8],[3,10],[7,10]],
      [[5,0],[6,0]], [[2,3],[1,3]], [[0,3],[0,0]]]);
    upper.cells.push({type:'hole',x:6,z:0},{type:'hole',x:1,z:3},{type:'ramp',x:0,z:3,rotation:2});
    upper.windows=[{x:0,z:0},{x:0,z:1},{x:1,z:1},{x:1,z:2},{x:1,z:4},{x:0,z:4}];
  }
  if(index===2) {
    upper=maze([[[0,0],[7,0],[7,2],[1,2],[1,4],[5,4]],
      [[0,7],[2,7],[2,9],[5,9],[5,6],[7,6],[7,10]]]);
    upper.cells.push({type:'hole',x:5,z:4},{type:'ramp',x:0,z:7,rotation:1});
  }
  if(index===3) upper.cells.push({type:'robot',x:3,z:7,rotation:1,rule:'right'});
  upper.cells.push({type:'goal',x:7,z:10,rotation:1});
  upper.walls=upper.walls.filter(w=>!(w.axis==='v' && w.x===COLS && w.z===10));
  return validateStage({version:1,...QUESTS[index],author:'marble_lab',limit:300,size:'M',
    balls:[{x:0,z:0}],floors:[upper,floor()]});
}
