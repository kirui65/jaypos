const vertexSource = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const fragmentSource = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform vec3 uBlack;
uniform vec3 uBronze;
uniform vec3 uGold;
uniform vec3 uPale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  uv.x *= uRes.x / uRes.y;
  vec2 p = uv * 1.6 + (uPointer - 0.5) * 0.11;
  float t = uTime * 0.06;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 1.3), fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 1.1));
  float f = fbm(p + 3.0 * r);
  float ridge = pow(1.0 - abs(2.0 * f - 1.0), 3.0);
  vec3 col = mix(uBlack, uBronze, smoothstep(0.25, 0.75, f) * 0.38);
  col = mix(col, uGold, ridge * 0.24);
  col += uPale * pow(ridge, 10.0) * 0.05;
  float vig = smoothstep(1.2, 0.2, length(gl_FragCoord.xy / uRes.xy - 0.5) * 1.4);
  gl_FragColor = vec4(col * mix(0.22, 0.56, vig), 1.0);
}
`;

function tokenColor(name: string): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = value.match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];
  const rgb = value.match(/([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  throw new Error(`Missing shader color token: ${name}`);
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function mountLoginShader(host: HTMLElement): () => void {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.loginShader = "true";
  const maybeGl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!maybeGl) throw new Error("WebGL unavailable");
  const gl: WebGLRenderingContext = maybeGl;

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let frame = 0;
  let lastFrame = 0;
  let startedAt = 0;
  let disposed = false;
  const pointer = { x: 0.5, y: 0.5 };
  const target = { x: 0.5, y: 0.5 };
  try {
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const activeProgram = gl.createProgram();
    if (!activeProgram) throw new Error("Unable to allocate shader program");
    program = activeProgram;
    gl.attachShader(activeProgram, vertex);
    gl.attachShader(activeProgram, fragment);
    gl.linkProgram(activeProgram);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(activeProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(activeProgram) ?? "Shader link failed");
    buffer = gl.createBuffer();
    if (!buffer) throw new Error("Unable to allocate shader geometry");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(activeProgram);
    const position = gl.getAttribLocation(activeProgram, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const colors = ["--ej-black", "--ej-bronze", "--ej-blue", "--ej-yellow"].map(tokenColor);
    ["uBlack", "uBronze", "uGold", "uPale"].forEach((name, index) => gl.uniform3fv(gl.getUniformLocation(activeProgram, name), colors[index]!));
    const resLocation = gl.getUniformLocation(activeProgram, "uRes");
    const timeLocation = gl.getUniformLocation(activeProgram, "uTime");
    const pointerLocation = gl.getUniformLocation(activeProgram, "uPointer");
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.65;
    const resize = () => {
      const width = Math.max(1, Math.floor(host.clientWidth * dpr));
      const height = Math.max(1, Math.floor(host.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.uniform2f(resLocation, width, height);
      }
    };
    const onPointer = (event: PointerEvent) => {
      target.x = event.clientX / Math.max(window.innerWidth, 1);
      target.y = 1 - event.clientY / Math.max(window.innerHeight, 1);
    };
    const onVisibility = () => {
      if (!document.hidden && !frame) frame = requestAnimationFrame(draw);
    };
    const onLost = (event: Event) => { event.preventDefault(); cleanup(); };
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pagehide", cleanup);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      canvas.remove();
      host.classList.remove("shader-ready");
    };
    function draw(now: number) {
      if (disposed) return;
      if (document.hidden) { frame = 0; return; }
      if (now - lastFrame >= 1000 / 30) {
        lastFrame = now;
        if (!startedAt) startedAt = now;
        pointer.x += (target.x - pointer.x) * 0.035;
        pointer.y += (target.y - pointer.y) * 0.035;
        resize();
        gl.uniform1f(timeLocation, (now - startedAt) / 1000);
        gl.uniform2f(pointerLocation, pointer.x, pointer.y);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      frame = requestAnimationFrame(draw);
    }

    host.append(canvas);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pagehide", cleanup, { once: true });
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onLost, { once: true });
    resize();
    frame = requestAnimationFrame((time) => {
      draw(time);
      requestAnimationFrame(() => host.classList.add("shader-ready"));
    });
    return cleanup;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    canvas.remove();
    throw error;
  }
}
