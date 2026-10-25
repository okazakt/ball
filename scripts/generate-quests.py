"""Generate repeatable quest layouts using randomized DFS spanning trees.

Stages 1/4 use cycle-edge exchanges (simulated annealing) to retain exactly
two deep detours while reducing straight runs. Stages 2/3 select DFS trees
that satisfy their trap/ramp constraints. Run from the repository root.
No runtime generation or third-party dependency is required.
"""
import random, math
W,H=8,11;N=88
def neighbors(n):
 x,z=n%W,n//W
 return [m for m in (n-1 if x else -1,n+1 if x<W-1 else -1,n-W if z else -1,n+W if z<H-1 else -1) if m>=0]
ALL=[(a,b) for a in range(N) for b in neighbors(a) if a<b]
def generate(seed,steps=15000):
 rng=random.Random(seed);g=[set() for _ in range(N)];visited={0};stack=[0]
 while stack:
  a=stack[-1];opts=[b for b in neighbors(a) if b not in visited]
  if not opts:stack.pop();continue
  b=rng.choice(opts);g[a].add(b);g[b].add(a);visited.add(b);stack.append(b)
 def analyze():
  parent={0:None};q=[0]
  for a in q:
   for b in g[a]:
    if b not in parent:parent[b]=a;q.append(b)
  p=[];a=87
  while a is not None:p.append(a);a=parent[a]
  p=p[::-1];on=set(p); branches=[];bad=0
  for a in p:
   for b in g[a]-on:
    path=[a,b]
    while len(g[path[-1]])==2:path.append(next(x for x in g[path[-1]] if x!=path[-2]))
    if len(g[path[-1]])!=1:bad+=1
    branches.append(path)
  def runs(path):
   ds=[(b%W-a%W,b//W-a//W) for a,b in zip(path,path[1:])];run=0;prev=None;rs=[]
   for d in ds:
    if d!=prev:
     if run:rs.append(run)
     run=0
    run+=1;prev=d
   if run:rs.append(run)
   return rs
  rs=runs(p); brs=[runs(b) for b in branches];last=runs(p[-7:]);leaves=sum(len(v)==1 for v in g)
  penalty=abs(leaves-4)*35+bad*35+abs(len(branches)-2)*30
  penalty+=sum(max(0,len(v)-3)*50 for v in g)+(len(g[0])-1+len(g[87])-1)*100
  penalty+=max(0,44-len(p))*3+sum(max(0,13-len(b))*5 for b in branches)
  penalty+=sum(max(0,r-3)**2*6 for r in rs)+sum(sum(max(0,r-4)**2*3 for r in rr) for rr in brs)
  penalty+=max(0,4-len(last))*8+sum(max(0,4-len(rr))*5 for rr in brs)
  junctions=sorted(p.index(branch[0]) for branch in branches)
  if len(junctions)==2:
   penalty+=max(0,12-(junctions[1]-junctions[0]))*5
   penalty+=max(0,8-junctions[0])*5+max(0,junctions[1]-(len(p)-9))*5
  return penalty,p,branches,rs
 score,*_=analyze();best=None
 for it in range(steps):
  a,b=rng.choice(ALL)
  if b in g[a]:continue
  parent={a:None};q=[a]
  for v in q:
   for u in g[v]:
    if u not in parent:parent[u]=v;q.append(u)
   if b in parent:break
  cycle=[];v=b
  while parent[v] is not None:cycle.append((v,parent[v]));v=parent[v]
  c,d=rng.choice(cycle);g[a].add(b);g[b].add(a);g[c].remove(d);g[d].remove(c)
  ns,p,bs,rs=analyze();temp=max(.25,6*(1-it/steps))
  if ns<=score or rng.random()<math.exp((score-ns)/temp):score=ns
  else:g[a].remove(b);g[b].remove(a);g[c].add(d);g[d].add(c)
  if ns==0:
   best=(p,bs,rs,[[a,b] for a in range(N) for b in g[a] if a<b]);break
 return score,best,it


def dfs(seed, excluded=()):
 rng=random.Random(seed);g={n:set() for n in range(N) if n not in excluded};seen={0};stack=[0]
 while stack:
  a=stack[-1];choices=[b for b in neighbors(a) if b in g and b not in seen]
  if not choices:stack.pop();continue
  b=rng.choice(choices);g[a].add(b);g[b].add(a);seen.add(b);stack.append(b)
 return g

def route(g,start,end):
 parent={start:None};queue=[start]
 for a in queue:
  for b in sorted(g[a]):
   if b not in parent:parent[b]=a;queue.append(b)
 if end not in parent:return []
 p=[];n=end
 while n is not None:p.append(n);n=parent[n]
 return p[::-1]

def run_lengths(path):
 lengths=[];previous=None
 for a,b in zip(path,path[1:]):
  d=(b%W-a%W,b//W-a//W)
  if d==previous:lengths[-1]+=1
  else:lengths.append(1)
  previous=d
 return lengths

def edges(g):return sorted([a,b] for a in g for b in g[a] if a<b)
def ramp(cell,rotation):return {'type':'ramp','x':cell%W,'z':cell//W,'rotation':rotation}
def hole(cell):return {'type':'hole','x':cell%W,'z':cell//W}
def describe(seed,g,path,cells,**extra):
 return dict(seed=seed,edges=edges(g),cells=cells,solution=path,turns=len(run_lengths(path))-1,**extra)

def traps():
 for seed in range(1,100000):
  g=dfs(seed,[16,24]);p=route(g,0,87);runs=run_lengths(p)
  if len(p)<48 or len(runs)<26 or max(runs)>4 or max(run_lengths(p[-7:]))>3:continue
  candidates=[]
  for i in range(8,len(p)-8):
   a,b=p[i-1:i+1]
   # Continuing straight at the mandatory turn must lead to a one-cell hole.
   dx=b%W-a%W;dz=b//W-a//W;x=b%W+dx;z=b//W+dz;c=z*W+x
   if 0<=x<W and 0<=z<H and c in g[b] and len(g[c])==1 and len(g[b])==3:candidates.append((i,c))
  pairs=[(a,b) for a in candidates for b in candidates if b[0]-a[0]>=8]
  if not pairs:continue
  first,second=pairs[0];g[16]={8,24};g[24]={16};g[8].add(16)
  return describe(seed,g,p,[hole(first[1]),hole(second[1]),ramp(24,2)],
    windows=[{'x':0,'z':0},{'x':0,'z':1},{'x':1,'z':1},{'x':1,'z':2},{'x':0,'z':4},{'x':1,'z':4}],trapJunctions=[p[first[0]],p[second[0]]])
 raise RuntimeError('No valid trap maze')

def descent():
 for seed in range(1,100000):
  g=dfs(seed);p=route(g,0,87);rs=run_lengths(p)
  if len(p)<55 or len(rs)<28 or max(rs)>4 or max(run_lengths(p[-7:]))>3:continue
  for i in range(22,len(p)-23):
   a,b,c,d=p[i-1:i+3]
   if len(g[b])!=2 or len(g[c])!=2 or (c%W-b%W,c//W-b//W)!=(d%W-c%W,d//W-c//W):continue
   g[a].remove(b);g[b].remove(a)
   front=[n for n in g if route(g,0,n)];back=[n for n in g if n not in front]
   tips=[n for n in front if len(g[n])==1 and n!=0 and abs(n%W-b%W)+abs(n//W-b//W)>=6 and len(route(g,0,n))>=24]
   if len(front)<30 or len(back)<30 or not tips:g[a].add(b);g[b].add(a);continue
   h=max(tips,key=lambda n:len(route(g,0,n)));delta=(c%W-b%W,c//W-b//W);rotation=[(0,1),(1,0),(0,-1),(-1,0)].index(delta)
   front_path=route(g,0,h);back_path=route(g,b,87)
   if max(run_lengths(front_path))>4 or len(run_lengths(front_path))<13 or len(run_lengths(back_path))<13:
    g[a].add(b);g[b].add(a);continue
   return describe(seed,g,front_path,[hole(h),ramp(b,rotation)],front=front,back=back,backSolution=back_path)
 raise RuntimeError('No valid descent maze')

if __name__=='__main__':
 import json,pathlib
 layouts=[]
 for seed,steps in [(2,60000),(7,60000)]:
  score,result,iterations=generate(seed,steps)
  if result is None:raise RuntimeError(f'No valid maze for seed {seed}: {score}')
  path,branches,runs,es=result;g={n:set() for n in range(N)}
  for a,b in es:g[a].add(b);g[b].add(a)
  cells=[]
  if layouts:
   # Start the robot in the deeper detour, facing towards its junction.
   branch=max(branches,key=len);n=branch[-1];towards=branch[-2];delta=(towards%W-n%W,towards//W-n//W)
   cells=[{'type':'robot','x':n%W,'z':n//W,'rotation':[(0,1),(1,0),(0,-1),(-1,0)].index(delta),'rule':'right'}]
  layouts.append(describe(seed,g,path,cells,branches=branches))
 layouts=[layouts[0],traps(),descent(),layouts[1]]
 target=pathlib.Path(__file__).resolve().parent.parent/'src'/'quest-layouts.js'
 target.write_text('// Generated by python3 scripts/generate-quests.py. Fixed seeds keep retries identical.\nexport const QUEST_LAYOUTS = '+json.dumps(layouts,separators=(',',':'))+';\n')
 for i,l in enumerate(layouts):print(i+1,'seed',l['seed'],'solution cells',len(l['solution']),'turns',l['turns'])
