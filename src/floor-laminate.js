const T = window.THREE;
export const PAPER_THICKNESS = .0025;

// Keep the existing floor silhouette and collision surface. Split triangles at
// the laminate boundary so only the top and the tiny paper edge carry print.
export function laminateFloorGeometry(source) {
  source.computeBoundingBox();
  const cut = source.boundingBox.max.y - PAPER_THICKNESS;
  const p = source.attributes.position, n = source.attributes.normal, uv = source.attributes.uv;
  const buckets = [[], []]; // printed paper, molded ABS core
  const vertex = i => [p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i),uv.getX(i),uv.getY(i)];
  const clip = (polygon, upper) => {
    const result = [];
    for (let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      const insideA=upper?a[1]>=cut:a[1]<=cut, insideB=upper?b[1]>=cut:b[1]<=cut;
      if(insideA) result.push(a);
      if(insideA!==insideB) {
        const t=(cut-a[1])/(b[1]-a[1]);
        result.push(a.map((v,j)=>v+(b[j]-v)*t));
      }
    }
    return result;
  };
  const count = source.index ? source.index.count : p.count;
  for(let i=0;i<count;i+=3) {
    const tri=[0,1,2].map(j=>vertex(source.index?source.index.getX(i+j):i+j));
    for(let material=0;material<2;material++) {
      const polygon=clip(tri,material===0);
      for(let j=1;j<polygon.length-1;j++) buckets[material].push(polygon[0],polygon[j],polygon[j+1]);
    }
  }
  const vertices=buckets.flat(), geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices.flatMap(v=>v.slice(0,3)),3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute(vertices.flatMap(v=>v.slice(3,6)),3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute(vertices.flatMap(v=>v.slice(6,8)),2));
  geometry.addGroup(0,buckets[0].length,0);
  geometry.addGroup(buckets[0].length,buckets[1].length,1);
  geometry.userData.paperThickness=PAPER_THICKNESS;
  source.dispose();
  return geometry;
}
