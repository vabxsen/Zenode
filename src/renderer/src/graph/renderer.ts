// WebGL2 graph renderer. Nodes and edges are instanced quads (two draw calls
// in total); labels are drawn on a 2D canvas layered on top.

export interface Camera {
  x: number
  y: number
  scale: number
}

export interface RenderNode {
  x: number
  y: number
  r: number
  color: [number, number, number, number]
  label: string
  labelAlpha: number
  labelBold: boolean
}

export interface RenderEdge {
  a: number
  b: number
  color: [number, number, number, number]
  width: number
}

const NODE_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aNode;   // x, y, radius (world units)
layout(location = 2) in vec4 aColor;
uniform vec2 uRes;
uniform vec3 uCam;                    // x, y, scale
out vec2 vLocal;
out float vRadiusPx;
out vec4 vColor;
void main() {
  float rpx = aNode.z * uCam.z;
  float padded = rpx + 1.5;
  vec2 screen = (aNode.xy - uCam.xy) * uCam.z + uRes * 0.5 + aCorner * padded;
  vLocal = aCorner * padded;
  vRadiusPx = rpx;
  vColor = aColor;
  vec2 clip = screen / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

const NODE_FS = `#version 300 es
precision mediump float;
in vec2 vLocal;
in float vRadiusPx;
in vec4 vColor;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  float alpha = 1.0 - smoothstep(vRadiusPx - 0.75, vRadiusPx + 0.75, d);
  if (alpha <= 0.0) discard;
  outColor = vec4(vColor.rgb, vColor.a * alpha);
}`

const EDGE_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;  // x: 0..1 along the edge, y: -1..1 across
layout(location = 1) in vec4 aEnds;    // ax, ay, bx, by (world)
layout(location = 2) in vec4 aColor;
layout(location = 3) in float aWidth;  // pixels
uniform vec2 uRes;
uniform vec3 uCam;
out float vAcross;
out float vHalf;
out vec4 vColor;
void main() {
  vec2 a = (aEnds.xy - uCam.xy) * uCam.z + uRes * 0.5;
  vec2 b = (aEnds.zw - uCam.xy) * uCam.z + uRes * 0.5;
  vec2 dir = b - a;
  float len = length(dir);
  dir = len > 0.0001 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float halfW = aWidth * 0.5 + 1.0;
  vec2 screen = mix(a, b, aCorner.x) + normal * aCorner.y * halfW;
  vAcross = aCorner.y * halfW;
  vHalf = aWidth * 0.5;
  vColor = aColor;
  vec2 clip = screen / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

const EDGE_FS = `#version 300 es
precision mediump float;
in float vAcross;
in float vHalf;
in vec4 vColor;
out vec4 outColor;
void main() {
  float alpha = 1.0 - smoothstep(vHalf - 0.5, vHalf + 0.5, abs(vAcross));
  outColor = vec4(vColor.rgb, vColor.a * alpha);
}`

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string): WebGLShader => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader error')
    return shader
  }
  const program = gl.createProgram()!
  gl.attachShader(program, make(gl.VERTEX_SHADER, vs))
  gl.attachShader(program, make(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error')
  return program
}

export class GraphRenderer {
  readonly glCanvas: HTMLCanvasElement
  readonly textCanvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private ctx: CanvasRenderingContext2D
  private nodeProgram: WebGLProgram
  private edgeProgram: WebGLProgram
  private nodeVao: WebGLVertexArrayObject
  private edgeVao: WebGLVertexArrayObject
  private nodeBuf: WebGLBuffer
  private edgeBuf: WebGLBuffer
  private nodeData = new Float32Array(0)
  private edgeData = new Float32Array(0)
  width = 0
  height = 0
  private dpr = 1

  constructor(container: HTMLElement) {
    this.glCanvas = document.createElement('canvas')
    this.textCanvas = document.createElement('canvas')
    this.glCanvas.className = 'zn-graph-canvas'
    this.textCanvas.className = 'zn-graph-canvas zn-graph-text'
    container.append(this.glCanvas, this.textCanvas)
    const gl = this.glCanvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: true })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.ctx = this.textCanvas.getContext('2d')!
    this.nodeProgram = compile(gl, NODE_VS, NODE_FS)
    this.edgeProgram = compile(gl, EDGE_VS, EDGE_FS)

    // Node quad: corners of a [-1, 1] square, drawn as a triangle strip.
    this.nodeVao = gl.createVertexArray()!
    gl.bindVertexArray(this.nodeVao)
    this.bindStatic(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))
    this.nodeBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuf)
    const nodeStride = 7 * 4
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, nodeStride, 0)
    gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, nodeStride, 12)
    gl.vertexAttribDivisor(2, 1)

    // Edge quad: (along, across).
    this.edgeVao = gl.createVertexArray()!
    gl.bindVertexArray(this.edgeVao)
    this.bindStatic(new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]))
    this.edgeBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf)
    const edgeStride = 9 * 4
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, edgeStride, 0)
    gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, edgeStride, 16)
    gl.vertexAttribDivisor(2, 1)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, edgeStride, 32)
    gl.vertexAttribDivisor(3, 1)
    gl.bindVertexArray(null)
  }

  private bindStatic(corners: Float32Array): void {
    const gl = this.gl
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1
    this.width = width
    this.height = height
    for (const c of [this.glCanvas, this.textCanvas]) {
      c.width = Math.max(1, Math.round(width * this.dpr))
      c.height = Math.max(1, Math.round(height * this.dpr))
      c.style.width = `${width}px`
      c.style.height = `${height}px`
    }
  }

  draw(cam: Camera, nodes: RenderNode[], edges: RenderEdge[]): void {
    const gl = this.gl
    const { dpr } = this
    gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    const res = [this.width * dpr, this.height * dpr] as const
    const camU = [cam.x, cam.y, cam.scale * dpr] as const

    // Edges first so nodes sit on top.
    if (edges.length) {
      if (this.edgeData.length < edges.length * 9) this.edgeData = new Float32Array(edges.length * 9 * 2)
      const d = this.edgeData
      edges.forEach((e, i) => {
        const a = nodes[e.a]
        const b = nodes[e.b]
        const o = i * 9
        d[o] = a.x
        d[o + 1] = a.y
        d[o + 2] = b.x
        d[o + 3] = b.y
        d.set(e.color, o + 4)
        d[o + 8] = e.width * dpr
      })
      gl.useProgram(this.edgeProgram)
      gl.uniform2f(gl.getUniformLocation(this.edgeProgram, 'uRes'), res[0], res[1])
      gl.uniform3f(gl.getUniformLocation(this.edgeProgram, 'uCam'), camU[0], camU[1], camU[2])
      gl.bindVertexArray(this.edgeVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf)
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, edges.length * 9), gl.DYNAMIC_DRAW)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, edges.length)
    }

    if (nodes.length) {
      if (this.nodeData.length < nodes.length * 7) this.nodeData = new Float32Array(nodes.length * 7 * 2)
      const d = this.nodeData
      nodes.forEach((n, i) => {
        const o = i * 7
        d[o] = n.x
        d[o + 1] = n.y
        d[o + 2] = n.r
        d.set(n.color, o + 3)
      })
      gl.useProgram(this.nodeProgram)
      gl.uniform2f(gl.getUniformLocation(this.nodeProgram, 'uRes'), res[0], res[1])
      gl.uniform3f(gl.getUniformLocation(this.nodeProgram, 'uCam'), camU[0], camU[1], camU[2])
      gl.bindVertexArray(this.nodeVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuf)
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, nodes.length * 7), gl.DYNAMIC_DRAW)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nodes.length)
    }
    gl.bindVertexArray(null)

    // Labels.
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const n of nodes) {
      if (n.labelAlpha <= 0.02) continue
      const sx = (n.x - cam.x) * cam.scale + this.width / 2
      const sy = (n.y - cam.y) * cam.scale + this.height / 2 + n.r * cam.scale + 4
      if (sx < -200 || sx > this.width + 200 || sy < -40 || sy > this.height + 40) continue
      ctx.font = `${n.labelBold ? 600 : 400} 12px 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`
      ctx.fillStyle = `rgba(220, 220, 232, ${n.labelAlpha})`
      ctx.fillText(n.label.length > 40 ? `${n.label.slice(0, 39)}…` : n.label, sx, sy)
    }
  }

  destroy(): void {
    const gl = this.gl
    gl.deleteBuffer(this.nodeBuf)
    gl.deleteBuffer(this.edgeBuf)
    gl.deleteVertexArray(this.nodeVao)
    gl.deleteVertexArray(this.edgeVao)
    gl.deleteProgram(this.nodeProgram)
    gl.deleteProgram(this.edgeProgram)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.glCanvas.remove()
    this.textCanvas.remove()
  }
}
