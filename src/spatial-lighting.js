import { COLS, ROWS, GAP, DIRECTIONS } from './mechanics.js';
// Keep PBR shading, but give moving objects a continuous lighting field instead
// of selecting a completely different room's lights at a floor index boundary.
const T=window.THREE, COUNT=8, RAMP_COUNT=44, tint=new T.Color();
export function exposureAt(y, radius=.4) {
  const t=Math.max(0,Math.min(1,(y+.24+radius)/(.39+2*radius)));
  return t*t*(3-2*t);
}
export function prepareSpatialMaterial(material, { surfaceField = false } = {}) {
  const uniforms={
    movingSun:{value:new T.Color()},movingSunDirection:{value:new T.Vector3()},
    movingSky:{value:new T.Color()},movingGround:{value:new T.Color()},
    movingPositions:{value:Array.from({length:COUNT},()=>new T.Vector3())},
    movingColors:{value:Array.from({length:COUNT},()=>new T.Color(0))},
    movingDirections:{value:Array.from({length:COUNT},()=>new T.Vector3())},
    movingParams:{value:Array.from({length:COUNT},()=>new T.Vector4())},
  };
  if(surfaceField)Object.assign(uniforms,{
    surfaceLowerSky:{value:new T.Color()},surfaceLowerGround:{value:new T.Color()},
    surfaceUpperEnabled:{value:1},surfaceEnvLevels:{value:new T.Vector2(.015,2)},
    movingApertures:{value:Array.from({length:COUNT},()=>new T.Vector2())},
    surfaceOpeningCenters:{value:Array.from({length:COUNT},()=>new T.Vector2())},
    surfaceRampCount:{value:0},surfaceRamps:{value:Array.from({length:RAMP_COUNT},()=>new T.Vector4())},
  });
  material.userData.surfaceField=surfaceField;
  material.userData.spatialUniforms=uniforms;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    if(surfaceField){
      shader.vertexShader='varying vec3 vSurfaceWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvSurfaceWorld=(modelMatrix*vec4(position,1.0)).xyz;');
      shader.fragmentShader=`varying vec3 vSurfaceWorld;
        uniform vec3 surfaceLowerSky, surfaceLowerGround;
        uniform float surfaceUpperEnabled; uniform vec2 surfaceEnvLevels;
        uniform vec2 movingApertures[${COUNT}], surfaceOpeningCenters[${COUNT}];
        uniform int surfaceRampCount; uniform vec4 surfaceRamps[${RAMP_COUNT}];\n`+shader.fragmentShader;
    }
    shader.fragmentShader=`uniform vec3 movingSun; uniform vec3 movingSunDirection;
      uniform vec3 movingSky; uniform vec3 movingGround;
      uniform vec3 movingPositions[${COUNT}]; uniform vec3 movingColors[${COUNT}];
      uniform vec3 movingDirections[${COUNT}]; uniform vec4 movingParams[${COUNT}];\n`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',`
      ${surfaceField ? `float heightExposure=smoothstep(${-GAP},0.0,vSurfaceWorld.y);
        float surfaceExposure=heightExposure;
        // The open ramp keeps its exterior light down to the landing. Extend
        // that light onto the floor, then fade by distance into the chamber.
        for(int r=0;r<${RAMP_COUNT};r++){
          if(r>=surfaceRampCount)break;
          vec2 outside=max(abs(vSurfaceWorld.xz-surfaceRamps[r].xy)-surfaceRamps[r].zw,vec2(0.0));
          float landingLight=(1.0-smoothstep(.15,2.25,length(outside)))*mix(.18,1.0,heightExposure);
          surfaceExposure=max(surfaceExposure,landingLight);
        }
        // Soft bounced light near openings raises crushed lower-floor shadows
        // without restoring the exterior brightness of the landing.
        for(int j=0;j<${COUNT};j++){
          if(movingApertures[j].x>0.0){
            float depth=max(0.0,movingApertures[j].y-vSurfaceWorld.y);
            float distanceFromOpening=length(vSurfaceWorld.xz-surfaceOpeningCenters[j]);
            float openingFill=.035*(1.0-smoothstep(movingApertures[j].x,movingApertures[j].x+max(depth,.05),distanceFromOpening));
            surfaceExposure=max(surfaceExposure,openingFill);
          }
        }` : ''}
      GeometricContext geometry;
      geometry.position=-vViewPosition; geometry.normal=normal;
      geometry.viewDir=(isOrthographic)?vec3(0.,0.,1.):normalize(vViewPosition);
      #ifdef USE_CLEARCOAT
        geometry.clearcoatNormal=clearcoatNormal;
      #endif
      IncidentLight directLight;
      directLight.direction=movingSunDirection; directLight.color=movingSun${surfaceField ? "*surfaceExposure" : ""}; directLight.visible=true;
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
        ${surfaceField ? `if(movingApertures[j].x>0.0){
          float depth=max(0.0,movingApertures[j].y-vSurfaceWorld.y);
          directLight.color*=1.0-depth/sqrt(depth*depth+movingApertures[j].x*movingApertures[j].x);
        }` : ''}
        RE_Direct(directLight,geometry,material,reflectedLight);
      }
      vec3 worldNormal=inverseTransformDirection(geometry.normal,viewMatrix);
      vec3 irradiance=PI*mix(
        ${surfaceField ? 'mix(surfaceLowerGround,movingGround,surfaceExposure),mix(surfaceLowerSky,movingSky,surfaceExposure)' : 'movingGround,movingSky'},worldNormal.y*.5+.5);
      vec3 iblIrradiance=vec3(0.);
      vec3 radiance=vec3(0.); vec3 clearcoatRadiance=vec3(0.);
    `);
    if(surfaceField)shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>',
      '#include <lights_fragment_maps>\n'+`
      #ifdef USE_ENVMAP
        float surfaceEnvironment=mix(surfaceEnvLevels.x,surfaceEnvLevels.y,surfaceExposure*surfaceUpperEnabled)/2.0;
        iblIrradiance*=surfaceEnvironment;
        radiance*=surfaceEnvironment;clearcoatRadiance*=surfaceEnvironment;
      #endif
      `);
  };
  material.customProgramCacheKey=()=> surfaceField ? 'continuous-abs-surface-v3' : 'continuous-room-pbr-v1';
  return material;
}
export function updateSpatialMaterial(game,mesh,exposure,envStrength=.22,apertureLimited=false) {
  const u=mesh.material.userData.spatialUniforms;if(!u)return;
  const surfaceField=mesh.material.userData.surfaceField;
  if(surfaceField){
    exposure=1;
    const ramps=game.stage.floors[0].cells.filter(c=>c.type==='ramp');
    u.surfaceRampCount.value=Math.min(ramps.length,RAMP_COUNT);
    for(let i=0;i<u.surfaceRampCount.value;i++){
      const c=ramps[i],[dx,dz]=DIRECTIONS[c.rotation??0];
      u.surfaceRamps.value[i].set(c.x-(COLS-1)/2+dx*.5,c.z-(ROWS-1)/2+dz*.5,.5+Math.abs(dx)*.5,.5+Math.abs(dz)*.5);
    }
    u.surfaceUpperEnabled.value=game.stage.floors[0].dark?0:1;
    u.surfaceLowerSky.value.copy(game.lowerAmbient.color).multiplyScalar(game.lowerAmbient.intensity*(game.stage.floors[1].dark?0:1));
    u.surfaceLowerGround.value.copy(game.lowerAmbient.groundColor).multiplyScalar(game.lowerAmbient.intensity*(game.stage.floors[1].dark?0:1));
  }
  const upper=game.stage.floors[0].dark?0:exposure;
  const lower=game.stage.floors[1].dark?0:1-exposure;
  u.movingSun.value.copy(game.sun.color).multiplyScalar(game.sun.intensity*Math.PI*upper);
  u.movingSunDirection.value.copy(game.sun.position).sub(game.sunTarget.position).transformDirection(game.camera.matrixWorldInverse);
  u.movingSky.value.copy(game.ambient.color).multiplyScalar(game.ambient.intensity*upper)
    .add(tint.copy(game.lowerAmbient.color).multiplyScalar(game.lowerAmbient.intensity*lower));
  u.movingGround.value.copy(game.ambient.groundColor).multiplyScalar(game.ambient.intensity*upper)
    .add(tint.copy(game.lowerAmbient.groundColor).multiplyScalar(game.lowerAmbient.intensity*lower));
  mesh.material.envMapIntensity=surfaceField?2:.015+(envStrength-.015)*upper;
  const lights=game.movingLights.filter(light=>light.visible && (light.userData.baseIntensity??light.intensity)>0)
    .sort((a,b)=>a.userData.spatialPosition.distanceToSquared(mesh.position)-b.userData.spatialPosition.distanceToSquared(mesh.position));
  for(let i=0;i<COUNT;i++){
    if(surfaceField)u.movingApertures.value[i].set(0,0);
    const light=lights[i];if(!light){u.movingColors.value[i].setRGB(0,0,0);u.movingParams.value[i].set(0,2,-1,1);continue;}
    u.movingPositions.value[i].copy(light.userData.spatialPosition).applyMatrix4(game.camera.matrixWorldInverse);
    // A spotlight is a point-source approximation of an opening. Limit its
    // energy on the sheltered slab by the aperture's solid angle;
    // otherwise the horizontal ABS surface reflects a white, unoccluded lamp.
    let apertureTransmission=1;
    if(surfaceField && light.userData.aperture){
      const {radius,y}=light.userData.aperture;
      u.movingApertures.value[i].set(radius,y);
      u.surfaceOpeningCenters.value[i].set(light.userData.spatialPosition.x,light.userData.spatialPosition.z);
    }
    if(!surfaceField && apertureLimited && light.userData.aperture){
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
