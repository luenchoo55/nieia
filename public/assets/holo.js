(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var card = document.getElementById("card");

  // ---------- pointer with lag ----------
  var tx = 0.62, ty = 0.38, cx = tx, cy = ty, lastMove = -1e9;
  function setTarget(x, y) {
    tx = x / window.innerWidth; ty = y / window.innerHeight; lastMove = performance.now();
  }
  window.addEventListener("pointermove", function (e) { setTarget(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches[0]) setTarget(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener("pointerdown", function (e) { setTarget(e.clientX, e.clientY); }, { passive: true });

  // ---------- effect A: WebGL ----------
  var canvas = document.getElementById("holoA");
  var gl = null, prog = null, uRes, uMouse, uTime, uK;
  try {
    gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  } catch (err) { gl = null; }

  var vs = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  var fs = [
    "precision mediump float;",
    "uniform vec2 r;uniform vec2 m;uniform float t;uniform float k;",
    "float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
    "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);",
    "return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}",
    "float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}",
    "void main(){",
    " vec2 uv=gl_FragCoord.xy/r; vec2 asp=vec2(r.x/r.y,1.);",
    " vec2 p=uv*asp; vec2 mp=m*asp; float d=length(p-mp);",
    " vec2 q=vec2(fbm(p*1.6+t*.03),fbm(p*1.6+vec2(5.2,1.3)-t*.025));",
    " float w=fbm(p*2.2+q*2.4+(p-mp)*.8+t*.02);",
    " float folds=sin((p.x*1.3+p.y*.7)*7.+w*9.+t*.25)*.5+.5;",
    " float hue=w*1.6+folds*.35+d*1.2-t*.03;",
    " vec3 c=.5+.5*cos(6.28318*(hue+vec3(0.,.33,.67)));",
    " c=mix(c,vec3(1.),.48);",
    " float glow=smoothstep(.6,0.,d);",
    " float a=(glow*.78+.08)*(.4+.6*folds)*k;",
    " gl_FragColor=vec4(c*a,a);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  if (gl) {
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uRes = gl.getUniformLocation(prog, "r");
      uMouse = gl.getUniformLocation(prog, "m");
      uTime = gl.getUniformLocation(prog, "t");
      uK = gl.getUniformLocation(prog, "k");
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } catch (err) { gl = null; }
  }

  function resize() {
    if (!gl) return;
    var scale = 0.55 * Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(window.innerWidth * scale));
    canvas.height = Math.max(1, Math.round(window.innerHeight * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- effect B: CSS fallback for devices without WebGL ----------
  var holoB = document.getElementById("holoB");

  // ---------- mode: A (WebGL) by default, B (CSS) as fallback ----------
  var mode = gl ? "A" : "B";
  canvas.hidden = mode !== "A";
  holoB.hidden = mode !== "B";

  // ---------- loop ----------
  var start = performance.now();
  function frame(now) {
    var t = (now - start) / 1000;
    if (now - lastMove > 4000 && !reduce) {
      tx = 0.5 + 0.28 * Math.sin(t * 0.13);
      ty = 0.42 + 0.2 * Math.sin(t * 0.21 + 1.3);
    }
    var ease = reduce ? 1 : 0.055;
    cx += (tx - cx) * ease; cy += (ty - cy) * ease;

    if (mode === "A" && gl) {
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uMouse, cx, 1 - cy);
      gl.uniform1f(uTime, reduce ? 12 : t);
      gl.uniform1f(uK, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      holoB.style.setProperty("--x", (cx * window.innerWidth).toFixed(1) + "px");
      holoB.style.setProperty("--y", (cy * window.innerHeight).toFixed(1) + "px");
      holoB.style.setProperty("--a", (reduce ? 40 : (t * 18) % 360).toFixed(1) + "deg");
    }
    document.documentElement.style.setProperty("--spin", (reduce ? 30 : (t * 10) % 360).toFixed(1) + "deg");
  }
  function loop(now) {
    if (!document.hidden) frame(now);
    requestAnimationFrame(loop);
  }

  if (reduce) { frame(performance.now()); } else { requestAnimationFrame(loop); }
})();
