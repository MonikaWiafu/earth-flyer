// Draws libfpv's Dear ImGui overlay (F8: radio wizard, rates, presets, OSD)
// from the flattened draw data in earthflyer_fpv.c, with WebGL2.

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec4 aCol;
uniform vec2 uSize;
out vec2 vUV; out vec4 vCol;
void main() {
  vUV = aUV; vCol = aCol;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 vUV; in vec4 vCol;
uniform sampler2D uTex;
out vec4 o;
void main() { o = vCol * texture(uTex, vUV); }`;

export class OverlayRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true, antialias: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    this.prog = p;
    this.uSize = gl.getUniformLocation(p, "uSize");
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 20, 16);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);
    this.textures = new Map(); // id -> {tex, revision}
  }

  _texture(id) {
    const gl = this.gl;
    const t = this.engine.texture(id);
    if (!t) return null;
    let e = this.textures.get(id);
    if (!e) { e = { tex: gl.createTexture(), revision: -1 }; this.textures.set(id, e); }
    if (e.revision !== t.revision) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.width, t.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(t.rgba));
      e.revision = t.revision;
    }
    return e.tex;
  }

  // cssW/cssH: overlay coordinates (CSS px); dpr: device pixel ratio.
  render(dt, cssW, cssH, dpr) {
    const gl = this.gl;
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dd = this.engine.overlayRender(dt);
    this.lastCommandCount = dd ? dd.count : 0;
    if (!dd) return false;

    gl.useProgram(this.prog);
    gl.uniform2f(this.uSize, cssW, cssH);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.SCISSOR_TEST);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(dd.vertices.buffer, dd.vertices.byteOffset, dd.vertices.byteLength), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(dd.indices), gl.STREAM_DRAW);
    gl.activeTexture(gl.TEXTURE0);

    let offset = 0;
    for (let c = 0; c < dd.count; c++) {
      const o = c * 6;
      const [x1, y1, x2, y2] = [dd.commands[o], dd.commands[o + 1], dd.commands[o + 2], dd.commands[o + 3]];
      const tex = this._texture(dd.commands[o + 4]);
      const count = dd.commands[o + 5];
      if (tex && x2 > x1 && y2 > y1) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.scissor(Math.round(x1 * dpr), Math.round(H - y2 * dpr), Math.round((x2 - x1) * dpr), Math.round((y2 - y1) * dpr));
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, offset * 4);
      }
      offset += count;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    return true;
  }
}
