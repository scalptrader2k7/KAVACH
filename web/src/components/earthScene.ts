import * as THREE from 'three';

/** Owns every GPU resource and listener; no application/API state is read or written. */
export function createEarthScene(host:HTMLDivElement,onReady:()=>void,onFailure:()=>void){
 let renderer:THREE.WebGLRenderer;
 try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'})}
 catch{onFailure();return {dispose:()=>{},setPaused:(_paused:boolean)=>{}}}
 renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure=1.2;
 renderer.setClearColor(0x000000,0);
 host.appendChild(renderer.domElement);
 const scene=new THREE.Scene();
 const camera=new THREE.PerspectiveCamera(33,1,.1,20);
 camera.position.z=3.65;
 const geometry=new THREE.SphereGeometry(1,80,48);
 const material=new THREE.MeshPhongMaterial({color:0xffffff,shininess:9,specular:0x23384b});
 const earth=new THREE.Mesh(geometry,material);
 // Obliquity is aesthetic; this is a visual, not an orbital/solar simulation.
 const axis=new THREE.Group();axis.rotation.z=THREE.MathUtils.degToRad(-14);
 earth.rotation.y=2.9;axis.add(earth);scene.add(axis);
 scene.add(new THREE.AmbientLight(0x8da8cb,.13));
 const sun=new THREE.DirectionalLight(0xfff5e9,3.1);sun.position.set(-3,2.4,3);scene.add(sun);
 const atmosphereGeometry=new THREE.SphereGeometry(1.018,80,48);
 const atmosphereMaterial=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,
  uniforms:{sunDirection:{value:sun.position.clone().normalize()}},
  vertexShader:`varying vec3 surfaceNormal; varying vec3 viewDirection;
   void main(){vec4 world=modelMatrix*vec4(position,1.0);surfaceNormal=normalize(mat3(modelMatrix)*normal);viewDirection=normalize(cameraPosition-world.xyz);gl_Position=projectionMatrix*viewMatrix*world;}`,
  fragmentShader:`uniform vec3 sunDirection; varying vec3 surfaceNormal; varying vec3 viewDirection;
   void main(){vec3 n=normalize(surfaceNormal);float rim=pow(1.0-max(dot(n,normalize(viewDirection)),0.0),3.5);float light=smoothstep(-0.3,0.8,dot(n,sunDirection));gl_FragColor=vec4(0.19,0.47,0.9,rim*(0.12+0.48*light));}`,
 });
 scene.add(new THREE.Mesh(atmosphereGeometry,atmosphereMaterial));
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 let paused=motion.matches,visible=false,loaded=false,disposed=false,last=0,lastFrame=0;
 const render=()=>renderer.render(scene,camera);
 function animate(time:number){
  if(time-lastFrame<1000/30)return;
  const delta=last?Math.min((time-last)/1000,.1):0;last=time;lastFrame=time;
  earth.rotation.y+=delta*.025;render();
 }
 function update(){
  if(disposed)return;
  last=0;
  if(loaded&&visible&&!document.hidden&&!paused)renderer.setAnimationLoop(animate);
  else{renderer.setAnimationLoop(null);if(loaded&&visible&&!document.hidden)render()}
 }
 function resize(){
  if(disposed)return;
  const {width,height}=host.getBoundingClientRect();
  if(!width||!height)return;
  renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
  if(loaded&&visible&&!document.hidden)render();
 }
 const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
 const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;update()},{threshold:0});intersection.observe(host);
 const changeMotion=()=>{paused=motion.matches;update()};motion.addEventListener('change',changeMotion);
 document.addEventListener('visibilitychange',update);
 const texture=new THREE.TextureLoader().load(new URL('../assets/earth/blue-marble-2048.jpg',import.meta.url).href,()=>{
  if(disposed){texture.dispose();return}
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  material.map=texture;material.needsUpdate=true;loaded=true;clearTimeout(timeout);resize();onReady();update();
 },undefined,fail);
 const timeout=window.setTimeout(fail,12000);
 function fail(){if(disposed)return;dispose();onFailure()}
 function contextLost(event:Event){event.preventDefault();fail()}
 renderer.domElement.addEventListener('webglcontextlost',contextLost);
 function dispose(){
  if(disposed)return;disposed=true;clearTimeout(timeout);renderer.setAnimationLoop(null);
  resizeObserver.disconnect();intersection.disconnect();motion.removeEventListener('change',changeMotion);
  document.removeEventListener('visibilitychange',update);renderer.domElement.removeEventListener('webglcontextlost',contextLost);
  geometry.dispose();material.dispose();atmosphereGeometry.dispose();atmosphereMaterial.dispose();texture.dispose();
  renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
 }
 resize();
 return {dispose,setPaused:(value:boolean)=>{paused=value;update()}};
}
