(function(){
  // --- Config (edit as needed) ---
  var GLB_URL = "https://hectoris919.github.io/interactive-blog-background/mewtwo.glb";
  var RBD_URL = "https://hectoris919.github.io/interactive-blog-background/mewtwo_ragdoll.json";
  var POST_SELECTOR = "#posts article[data-post-id]"; // your theme's post wrapper
  var PX_TO_M = 0.01; // DOM pixels → meters (100px = 1m)

  // --- Sanity: required globals from <script> tags ---
  if (!window.THREE || !THREE.GLTFLoader) { console.error("[bg] THREE/GLTFLoader missing – load three.min.js + GLTFLoader.js BEFORE bg.js"); return; }
  if (!window.CANNON) { console.error("[bg] CANNON missing – load cannon-es.umd.js BEFORE bg.js"); return; }

  // --- Create / locate background container ---
  var bg = document.getElementById("physics-bg");
  if (!bg) {
    bg = document.createElement("div");
    bg.id = "physics-bg";
    bg.style.cssText = "position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse at 50% 15%, rgba(255,255,255,.05), rgba(0,0,0,.22));";
    document.body.prepend(bg);
  }

  // --- THREE ---
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 300);
  camera.position.set(0, 2.2, 18);
  var renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  bg.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x283044, 1.0));
  var d = new THREE.DirectionalLight(0xffffff, 1.2); d.position.set(5,12,8); scene.add(d);

  // --- CANNON ---
  var world = new CANNON.World({ gravity: new CANNON.Vec3(0,-9.82,0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial = new CANNON.ContactMaterial(new CANNON.Material('mat'), new CANNON.Material('mat'), { friction:0.4, restitution:0.15 });

  // --- Load assets ---
  var gltfLoader = new THREE.GLTFLoader();
  var gltf=null, rbd=null;

  gltfLoader.load(GLB_URL, function(res){
    gltf = res;
    fetch(RBD_URL, { cache:"no-store" })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(json){ rbd = json; boot(); })
      .catch(function(){ boot(); });
  }, undefined, function(err){ console.error('[bg] GLB failed', err); });

  function v3(a){ return new CANNON.Vec3(a[0],a[1],a[2]); }
  function q4(a){ return new CANNON.Quaternion(a[0],a[1],a[2],a[3]); }

  var bodiesByName = new Map();
  var pickMeshes   = new Map();

  function addBodyMesh(body, desc){
    var mat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.25, color:0xb7b2ff, depthWrite:false });
    var mesh;
    if (desc.type === 'BOX')      mesh = new THREE.Mesh(new THREE.BoxGeometry(desc.size[0]*2, desc.size[1]*2, desc.size[2]*2), mat);
    else if (desc.type === 'SPHERE') mesh = new THREE.Mesh(new THREE.SphereGeometry(desc.radius, 16, 16), mat);
    else if (desc.type === 'CYLINDER') mesh = new THREE.Mesh(new THREE.CylinderGeometry(desc.radius, desc.radius, desc.height, 12), mat);
    else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3), mat);
    mesh.visible = true; mesh.frustumCulled = false; scene.add(mesh); pickMeshes.set(body, mesh);
  }

  function makeCapsuleBody(radius, height, opts){
    var body = new CANNON.Body(opts);
    var cylH = Math.max(0.001, height - 2*radius);
    if (cylH > 0) body.addShape(new CANNON.Cylinder(radius, radius, cylH, 8));
    var s = new CANNON.Sphere(radius);
    body.addShape(s, new CANNON.Vec3(0, +Math.max(0, cylH*0.5), 0));
    body.addShape(s, new CANNON.Vec3(0, -Math.max(0, cylH*0.5), 0));
    return body;
  }

  function buildBodiesFromJSON(json){
    for (var i=0;i<json.bodies.length;i++){
      var b = json.bodies[i];
      var body, desc={ type:b.shape };
      if (b.shape==='BOX'){ body=new CANNON.Body({mass:b.mass}); body.addShape(new CANNON.Box(v3(b.size))); desc.size=b.size; }
      else if (b.shape==='SPHERE'){ body=new CANNON.Body({mass:b.mass}); body.addShape(new CANNON.Sphere(b.radius)); desc.radius=b.radius; }
      else if (b.shape==='CYLINDER'){ body=new CANNON.Body({mass:b.mass}); body.addShape(new CANNON.Cylinder(b.radius,b.radius,b.height,8)); desc.radius=b.radius; desc.height=b.height; }
      else if (b.shape==='CAPSULE'){ body=makeCapsuleBody(b.radius,b.height,{mass:b.mass}); desc.radius=b.radius; desc.height=b.height; }
      else { body=new CANNON.Body({mass:b.mass}); body.addShape(new CANNON.Box(v3(b.size||[.2,.2,.2]))); desc={type:'BOX', size:b.size||[.2,.2,.2]}; }
      body.position.copy(v3(b.transform.position)); body.quaternion.copy(q4(b.transform.quaternion));
      body.linearDamping = b.linearDamping || 0.02; body.angularDamping = b.angularDamping || 0.02;
      world.addBody(body); bodiesByName.set(b.name, body); addBodyMesh(body, desc);
    }
  }

  function spawnDemoRagdolls(n){ n=n||3; for (var i=0;i<n;i++){
    var pelvis=new CANNON.Body({mass:4}); pelvis.addShape(new CANNON.Box(new CANNON.Vec3(.35,.2,.18)));
    pelvis.position.set((i-1)*1.2, 4+i*0.3, 0); world.addBody(pelvis); bodiesByName.set('demo_pelvis_'+i, pelvis); addBodyMesh(pelvis,{type:'BOX',size:[.35,.2,.18]});
    var head=new CANNON.Body({mass:1.5}); head.addShape(new CANNON.Sphere(.18)); head.position.set(pelvis.position.x, pelvis.position.y+1.0, 0); world.addBody(head); bodiesByName.set('demo_head_'+i, head); addBodyMesh(head,{type:'SPHERE',radius:.18});
    world.addConstraint(new CANNON.PointToPointConstraint(pelvis, new CANNON.Vec3(0,.4,0), head, new CANNON.Vec3(0,-.2,0)));
  } }

  function boot(){
    var model = gltf.scene; model.traverse(function(o){ if(o.isMesh){ o.castShadow=o.receiveShadow=false; }});
    scene.add(model);

    var haveJSON = !!(rbd && rbd.bodies && rbd.bodies.length);
    if (haveJSON) buildBodiesFromJSON(rbd); else spawnDemoRagdolls(3);

    // constraints from JSON (basic types)
    if (haveJSON){
      function axisFromQuat(qArr){ var q=new THREE.Quaternion(qArr[0],qArr[1],qArr[2],qArr[3]); var v=new THREE.Vector3(0,0,1).applyQuaternion(q); return new CANNON.Vec3(v.x,v.y,v.z); }
      for (var j=0;j<(rbd.constraints||[]).length;j++){
        var c = rbd.constraints[j]; var A=bodiesByName.get(c.object1), B=bodiesByName.get(c.object2); if(!A||!B) continue;
        var pivotA=v3(c.frameA.position), pivotB=v3(c.frameB.position); var jc=null;
        if (c.type==='POINT') jc=new CANNON.PointToPointConstraint(A,pivotA,B,pivotB);
        else if (c.type==='HINGE') jc=new CANNON.HingeConstraint(A,B,{ pivotA:pivotA, pivotB:pivotB, axisA:axisFromQuat(c.frameA.quaternion), axisB:axisFromQuat(c.frameB.quaternion) });
        else if (c.type==='CONE_TWIST') jc=new CANNON.ConeTwistConstraint(A,B,{ pivotA:pivotA, pivotB:pivotB });
        else jc=new CANNON.LockConstraint(A,B);
        world.addConstraint(jc, !!c.disableCollisions);
      }
    }

    // posts → static colliders
    var postBodies = new Map();
    function syncPostColliders(){
      var posts = Array.prototype.slice.call(document.querySelectorAll(POST_SELECTOR));
      var seen = new Set();
      posts.forEach(function(el, i){
        var r = el.getBoundingClientRect(); var id = el.getAttribute('data-post-id') || ('p'+i); seen.add(id);
        var hw=(r.width*PX_TO_M)/2, hh=(r.height*PX_TO_M)/2, dz=0.5;
        var cx=((r.left + r.width/2) - window.innerWidth/2) * PX_TO_M; var cy=(window.innerHeight/2 - (r.top + r.height/2)) * PX_TO_M;
        var d = postBodies.get(id);
        if (!d){ var body=new CANNON.Body({ type:CANNON.Body.STATIC }); body.addShape(new CANNON.Box(new CANNON.Vec3(hw,hh,dz))); world.addBody(body); d={body:body}; postBodies.set(id,d); }
        d.body.position.set(cx,cy,0);
      });
      postBodies.forEach(function(d, id){ if(!seen.has(id)){ world.removeBody(d.body); postBodies.delete(id); } });
    }
    window.addEventListener('scroll', throttle(syncPostColliders,100), { passive:true });
    window.addEventListener('resize', function(){ onResize(); syncPostColliders(); });
    syncPostColliders();

    // dragging
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var mouseBody = new CANNON.Body({ type:CANNON.Body.KINEMATIC, shape:new CANNON.Sphere(0.01) });
    world.addBody(mouseBody);
    var dragConstraint=null;
    function screenToWorld(x,y,z){ z=z||0; mouse.set((x/window.innerWidth)*2-1, -(y/window.innerHeight)*2+1); raycaster.setFromCamera(mouse, camera); var t=(z-raycaster.ray.origin.z)/raycaster.ray.direction.z; var p=raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(t)); return p; }
    function pick(ev){ var meshes=Array.from(pickMeshes.values()); mouse.set((ev.clientX/window.innerWidth)*2-1, -(ev.clientY/window.innerHeight)*2+1); raycaster.setFromCamera(mouse, camera); var hit=raycaster.intersectObjects(meshes,false)[0]; if(!hit) return; var body = Array.from(pickMeshes.entries()).find(function(entry){return entry[1]===hit.object;}); if(!body) return; mouseBody.position.copy(hit.point); dragConstraint=new CANNON.PointToPointConstraint(body[0], new CANNON.Vec3(), mouseBody, new CANNON.Vec3()); world.addConstraint(dragConstraint); }
    function move(ev){ var p=screenToWorld(ev.clientX,ev.clientY,0); mouseBody.position.set(p.x,p.y,p.z); }
    function release(){ if(dragConstraint){ world.removeConstraint(dragConstraint); dragConstraint=null; } }
    window.addEventListener('pointerdown', pick);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // gyro (mobile web)
    var gyroBtn = document.getElementById('gyro-btn');
    if (!gyroBtn){ gyroBtn = document.createElement('button'); gyroBtn.id='gyro-btn'; gyroBtn.textContent='Enable Motion'; gyroBtn.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2;padding:10px 12px;border:0;border-radius:999px;background:rgba(0,0,0,.75);color:#fff;font:600 12px system-ui;display:none;'; document.body.appendChild(gyroBtn); }
    if ('DeviceOrientationEvent' in window){ gyroBtn.style.display='inline-flex'; gyroBtn.onclick = function(){ try{ if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission){ DeviceOrientationEvent.requestPermission().then(function(p){ if(p!=='granted') return; startGyro(); gyroBtn.remove(); }); } else { startGyro(); gyroBtn.remove(); } }catch(e){} }; }
    function startGyro(){ window.addEventListener('deviceorientation', function(e){ var gx=9.82*Math.sin((e.gamma||0)*Math.PI/180); var gy=-9.82*Math.cos((e.beta||0)*Math.PI/180); world.gravity.set(gx,gy,0); }, { passive:true }); }

    // debug pill
    var dbg=document.createElement('div'); dbg.style.cssText='position:fixed;left:8px;bottom:8px;z-index:3;padding:6px 8px;background:rgba(0,0,0,.55);color:#fff;font:11px/1.2 system-ui;border-radius:8px';
    dbg.textContent='GLB: ok | JSON: '+(haveJSON?'ok':'missing')+' | bodies: '+(bodiesByName.size||0); document.body.appendChild(dbg);

    // loop
    var last = performance.now();
    function tick(){ var now=performance.now(), dt=Math.min(0.033,(now-last)/1000); last=now; world.step(1/60, dt, 3); pickMeshes.forEach(function(mesh, body){ mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); }); renderer.render(scene, camera); requestAnimationFrame(tick); }
    window.addEventListener('resize', onResize);
    requestAnimationFrame(tick);
  }

  function onResize(){ camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }
  function throttle(fn, ms){ var t=0, a=null; return function(){ a=arguments; var n=performance.now(); if(n-t>ms){ t=n; fn.apply(null,a); } }; }
})();
