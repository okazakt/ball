// Keep PBR shading, but give moving objects a continuous lighting field instead
// of selecting a completely different room's lights at a floor index boundary.
const T=window.THREE, COUNT=8, tint=new T.Color();
export function exposureAt(y, radius=.4) {
  const t=Math.max(0,Math.min(1,(y+.24+radius)/(.39+2*radius)));
  return t*t*(3-2*t);
}
export function prepareSpatialMaterial(material) {
  const uniforms={
    movingSun:{value:new T.Color()},movingSunDirection:{value:new T.Vector3()},
    movingSky:{value:new T.Color()},movingGround:{value:new T.Color()},
    movingPositions:{value:Array.from({length:COUNT},()=>new T.Vector3())},
    movingColors:{value:Array.from({length:COUNT},()=>new T.Color(0))},
    movingDirections:{value:Array.from({length:COUNT},()=>new T.Vector3())},
    movingParams:{value:Array.from({length:COUNT},()=>new T.Vector4())},
  };
  material.userData.spatialUniforms=uniforms;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader=`uniform vec3 movingSun; uniform vec3 movingSunDirection;
      uniform vec3 movingSky; uniform vec3 movingGround;
      uniform vec3 movingPositions[${COUNT}]; uniform vec3 movingColors[${COUNT}];
      uniform vec3 movingDirections[${COUNT}]; uniform vec4 movingParams[${COUNT}];\n`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',`
      GeometricContext geometry;
      geometry.position=-vViewPosition; geometry.normal=normal;
      geometry.viewDir=(isOrthographic)?vec3(0.,0.,1.):normalize(vViewPosition);
      #ifdef USE_CLEARCOAT
        geometry.clearcoatNormal=clearcoatNormal;
      #endif
      IncidentLight directLight;
      directLight.direction=movingSunDirection; directLight.color=movingSun; directLight.visible=true;
      RE_Direct(directLight,geometry,material,reflectedLight);
      for(int j=0;j<${COUNT};j++){
        vec3 delta=movingPositions[j]-geometry.position;
        float distanceToLight=length(delta);
        directLight.direction=delta/max(distanceToLight,.0001);
        directLight.color=movingColors[j]*getDistanceAttenuation(distanceToLight,movingParams[j].x,movingParams[j].y);
        if(movingParams[j].z>-.99){
          float cone=dot(-directLight.direction,movingDirections[j]);
          directLight.color*=smoothstep(movingParams[j].z,movingParams[j].w,cone);
        }
        RE_Direct(directLight,geometry,material,reflectedLight);
      }
      vec3 worldNormal=inverseTransformDirection(geometry.normal,viewMatrix);
      vec3 irradiance=PI*mix(movingGround,movingSky,worldNormal.y*.5+.5);
      vec3 iblIrradiance=vec3(0.);
      vec3 radiance=vec3(0.); vec3 clearcoatRadiance=vec3(0.);
    `);
  };
  material.customProgramCacheKey=()=> 'continuous-room-pbr-v1';
  return material;
}
export function updateSpatialMaterial(game,mesh,exposure,envStrength=.22,apertureLimited=false) {
  const u=mesh.material.userData.spatialUniforms;if(!u)return;
  const upper=game.stage.floors[0].dark?0:exposure;
  const lower=game.stage.floors[1].dark?0:1-exposure;
  u.movingSun.value.copy(game.sun.color).multiplyScalar(game.sun.intensity*Math.PI*upper);
  u.movingSunDirection.value.copy(game.sun.position).sub(game.sunTarget.position).transformDirection(game.camera.matrixWorldInverse);
  u.movingSky.value.copy(game.ambient.color).multiplyScalar(game.ambient.intensity*upper)
    .add(tint.copy(game.lowerAmbient.color).multiplyScalar(game.lowerAmbient.intensity*lower));
  u.movingGround.value.copy(game.ambient.groundColor).multiplyScalar(game.ambient.intensity*upper)
    .add(tint.copy(game.lowerAmbient.groundColor).multiplyScalar(game.lowerAmbient.intensity*lower));
  mesh.material.envMapIntensity=.015+(envStrength-.015)*upper;
  const lights=game.movingLights.filter(light=>light.visible && (light.userData.baseIntensity??light.intensity)>0)
    .sort((a,b)=>a.userData.spatialPosition.distanceToSquared(mesh.position)-b.userData.spatialPosition.distanceToSquared(mesh.position));
  for(let i=0;i<COUNT;i++){
    const light=lights[i];if(!light){u.movingColors.value[i].setRGB(0,0,0);u.movingParams.value[i].set(0,2,-1,1);continue;}
    u.movingPositions.value[i].copy(light.userData.spatialPosition).applyMatrix4(game.camera.matrixWorldInverse);
    // A spotlight is a point-source approximation of an opening. Limit its
    // energy on the sheltered slab by the aperture's solid angle;
    // otherwise the horizontal ABS surface reflects a white, unoccluded lamp.
    let apertureTransmission=1;
    if(apertureLimited && light.userData.aperture){
      const {radius,y}=light.userData.aperture;
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      const depth=Math.max(0,y-(mesh.position.y+mesh.geometry.boundingBox.max.y));
      apertureTransmission=1-depth/Math.sqrt(depth*depth+radius*radius);
    }
    u.movingColors.value[i].copy(light.color).multiplyScalar((light.userData.baseIntensity??light.intensity)*Math.PI*apertureTransmission);
    if(light.isSpotLight){
      u.movingDirections.value[i].copy(light.userData.spatialTarget).sub(light.userData.spatialPosition).transformDirection(game.camera.matrixWorldInverse);
      u.movingParams.value[i].set(light.distance,light.decay,Math.cos(light.angle),Math.cos(light.angle*(1-light.penumbra)));
    }else u.movingParams.value[i].set(light.distance,light.decay,-1,1);
  }
}
