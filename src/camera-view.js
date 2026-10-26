import { COLS, ROWS, GAP, FLOOR_THICKNESS } from './mechanics.js';

// One pose per viewport size. Fit the whole case for every supported board
// tilt, instead of moving or zooming the camera in response to the ball/tilt.
export function tiltedBoardCamera(aspect,cols=COLS,rows=ROWS,maxTilt=.5) {
  if(!Number.isFinite(aspect)||aspect<=0)throw Error('Invalid camera aspect');
  const fov=34,tanV=Math.tan(fov*Math.PI/360),tanH=tanV*aspect;
  const upY=.5,upZ=-Math.sqrt(3)/2,eyeY=Math.sqrt(3)/2,eyeZ=.5;
  const bottom=-GAP-FLOOR_THICKNESS,top=1.31,centerY=(bottom+top)/2;
  let distance=1;
  for(let ix=0;ix<=8;ix++)for(let iz=0;iz<=8;iz++) {
    const rx=-maxTilt+2*maxTilt*ix/8,rz=-maxTilt+2*maxTilt*iz/8;
    const cx=Math.cos(rx),sx=Math.sin(rx),cz=Math.cos(rz),sz=Math.sin(rz);
    for(const x of [-cols/2-.2,cols/2+.2])for(const y of [bottom,top])for(const z of [-rows/2-.2,rows/2+.2]) {
      const px=cz*x-sz*y,py=cx*(sz*x+cz*y)-sx*z-centerY,pz=sx*(sz*x+cz*y)+cx*z;
      const towardsEye=py*eyeY+pz*eyeZ;
      distance=Math.max(distance,towardsEye+Math.max(Math.abs(px)/tanH,Math.abs(py*upY+pz*upZ)/tanV)*1.06);
    }
  }
  return {fov,near:.1,far:distance+40,position:{x:0,y:centerY+eyeY*distance,z:eyeZ*distance},target:{x:0,y:centerY,z:0}};
}
