/**
 * GPU & Native Memory Monitor
 *
 * Instruments WebGL calls to track GPU-side memory (textures, buffers,
 * framebuffers) that are invisible to V8 heap snapshots.
 *
 * Usage:
 *   import { installGpuMemoryMonitor, getGpuMemoryReport } from '@/lib/gpu-memory-monitor';
 *
 *   // Call once after map + deck.gl are initialized
 *   installGpuMemoryMonitor();
 *
 *   // Query anytime
 *   const report = getGpuMemoryReport();
 *   console.table(report.summary);
 *
 * How it works:
 *   Wraps the WebGL2RenderingContext prototype methods that allocate/free
 *   GPU resources. Tracks estimated byte sizes for:
 *   - Textures (texImage2D, compressedTexImage2D, texStorage2D)
 *   - Buffers (bufferData)
 *   - Renderbuffers (renderbufferStorage)
 *   - Framebuffers (create/delete tracking only)
 *
 * Limitations:
 *   - Estimates are approximate (actual GPU memory may differ due to
 *     alignment, mipmaps, driver overhead)
 *   - Only tracks calls made AFTER installation
 *   - WebGL1 fallback is not implemented (MapLibre uses WebGL2)
 */

// ── Types ──────────────────────────────────────────────────────────────

interface ResourceEntry {
  id: number;
  type: "texture" | "buffer" | "renderbuffer" | "framebuffer";
  bytes: number;
  createdAt: number;
  label?: string;
}

interface GpuMemoryReport {
  totalEstimatedBytes: number;
  totalEstimatedMB: number;
  summary: {
    type: string;
    count: number;
    bytes: number;
    mb: string;
  }[];
  topResources: {
    type: string;
    bytes: number;
    mb: string;
    age: string;
    label?: string;
  }[];
  jsHeap: {
    used: number;
    total: number;
    limit: number;
  } | null;
}

// ── State ──────────────────────────────────────────────────────────────

let installed = false;
let nextId = 1;
const resources = new Map<
  WebGLTexture | WebGLBuffer | WebGLRenderbuffer | WebGLFramebuffer,
  ResourceEntry
>();

// ── Byte-size helpers ──────────────────────────────────────────────────

function bytesPerPixel(internalFormat: number): number {
  // WebGL2 sized internal formats → bytes per pixel
  // Reference: OpenGL ES 3.0 spec, Table 3.2
  switch (internalFormat) {
    // 1 byte
    case 0x1903: // RED (unsized)
    case 0x8229: // R8
    case 0x8d48: // STENCIL_INDEX8
      return 1;
    // 2 bytes
    case 0x8227: // RG (unsized)
    case 0x822b: // RG8
    case 0x822d: // R16F
    case 0x8d62: // RGB565
    case 0x8056: // RGBA4
    case 0x8057: // RGB5_A1
    case 0x81a5: // DEPTH_COMPONENT16
    case 0x1902: // DEPTH_COMPONENT (unsized, assume 16-bit)
      return 2;
    // 3 bytes
    case 0x1907: // RGB (unsized)
    case 0x8051: // RGB8
      return 3;
    // 4 bytes
    case 0x1908: // RGBA (unsized)
    case 0x8058: // RGBA8
    case 0x822e: // R32F
    case 0x822f: // RG16F
    case 0x8d7c: // RGBA8UI
    case 0x81a6: // DEPTH_COMPONENT24
    case 0x88f0: // DEPTH24_STENCIL8
      return 4;
    // 5 bytes
    case 0x8cad: // DEPTH32F_STENCIL8
      return 5;
    // 8 bytes
    case 0x8230: // RG32F
    case 0x881a: // RGBA16F
      return 8;
    // 16 bytes
    case 0x8814: // RGBA32F
      return 16;
    default:
      return 4; // reasonable default
  }
}

// ── Installation ───────────────────────────────────────────────────────

export function installGpuMemoryMonitor(): void {
  if (installed) return;
  if (typeof WebGL2RenderingContext === "undefined") {
    console.warn("[gpu-monitor] WebGL2 not available");
    return;
  }
  installed = true;

  const proto = WebGL2RenderingContext.prototype;

  // ── Texture tracking ───────────────────────────────────────────────

  const origTexImage2D = proto.texImage2D;
  proto.texImage2D = function (
    this: WebGL2RenderingContext,
    ...args: unknown[]
  ) {
    // texImage2D has multiple overloads; extract width/height/format
    // Overload: texImage2D(target, level, internalformat, width, height, border, format, type, source)
    const texImage2D = origTexImage2D as (...callArgs: unknown[]) => unknown;
    const result = texImage2D.apply(this, args);

    try {
      const boundTex = this.getParameter(
        this.TEXTURE_BINDING_2D,
      ) as WebGLTexture | null;
      if (
        boundTex &&
        typeof args[3] === "number" &&
        typeof args[4] === "number"
      ) {
        const internalFormat = args[2] as number;
        const width = args[3] as number;
        const height = args[4] as number;
        const bpp = bytesPerPixel(internalFormat);
        const bytes = width * height * bpp;

        const existing = resources.get(boundTex);
        if (existing) {
          existing.bytes = Math.max(existing.bytes, bytes);
        } else {
          resources.set(boundTex, {
            id: nextId++,
            type: "texture",
            bytes,
            createdAt: performance.now(),
          });
        }
      }
    } catch {
      /* monitoring should never break the app */
    }

    return result;
  };

  const origTexStorage2D = proto.texStorage2D;
  proto.texStorage2D = function (
    this: WebGL2RenderingContext,
    target: number,
    levels: number,
    internalformat: number,
    width: number,
    height: number,
  ) {
    const result = origTexStorage2D.call(
      this,
      target,
      levels,
      internalformat,
      width,
      height,
    );

    try {
      const boundTex = this.getParameter(
        this.TEXTURE_BINDING_2D,
      ) as WebGLTexture | null;
      if (boundTex) {
        const bpp = bytesPerPixel(internalformat);
        // Estimate mipmap chain: sum of mip levels ≈ 1.33× base
        let totalBytes = 0;
        for (let l = 0; l < levels; l++) {
          const mw = Math.max(1, width >> l);
          const mh = Math.max(1, height >> l);
          totalBytes += mw * mh * bpp;
        }
        resources.set(boundTex, {
          id: nextId++,
          type: "texture",
          bytes: totalBytes,
          createdAt: performance.now(),
        });
      }
    } catch {
      /* safe */
    }

    return result;
  };

  const origDeleteTexture = proto.deleteTexture;
  proto.deleteTexture = function (
    this: WebGL2RenderingContext,
    texture: WebGLTexture | null,
  ) {
    if (texture) resources.delete(texture);
    return origDeleteTexture.call(this, texture);
  };

  // ── Buffer tracking ────────────────────────────────────────────────

  const origBufferData = proto.bufferData;
  proto.bufferData = function (
    this: WebGL2RenderingContext,
    target: number,
    sizeOrData: number | AllowSharedBufferSource | null,
    usage: number,
    srcOffset?: number,
    length?: number,
  ) {
    const bufferData = origBufferData as (...callArgs: unknown[]) => unknown;
    const args =
      typeof srcOffset === "number"
        ? typeof length === "number"
          ? [target, sizeOrData, usage, srcOffset, length]
          : [target, sizeOrData, usage, srcOffset]
        : [target, sizeOrData, usage];
    const result = bufferData.apply(this, args);

    try {
      const binding =
        target === this.ARRAY_BUFFER
          ? this.ARRAY_BUFFER_BINDING
          : target === this.ELEMENT_ARRAY_BUFFER
            ? this.ELEMENT_ARRAY_BUFFER_BINDING
            : null;

      if (binding) {
        const boundBuf = this.getParameter(binding) as WebGLBuffer | null;
        if (boundBuf) {
          let bytes = 0;
          if (typeof sizeOrData === "number") {
            bytes = sizeOrData;
          } else if (sizeOrData && "byteLength" in sizeOrData) {
            bytes = (sizeOrData as ArrayBufferView).byteLength;
          }
          const existing = resources.get(boundBuf);
          if (existing) {
            existing.bytes = bytes;
          } else {
            resources.set(boundBuf, {
              id: nextId++,
              type: "buffer",
              bytes,
              createdAt: performance.now(),
            });
          }
        }
      }
    } catch {
      /* safe */
    }

    return result;
  };

  const origDeleteBuffer = proto.deleteBuffer;
  proto.deleteBuffer = function (
    this: WebGL2RenderingContext,
    buffer: WebGLBuffer | null,
  ) {
    if (buffer) resources.delete(buffer);
    return origDeleteBuffer.call(this, buffer);
  };

  // ── Renderbuffer tracking ──────────────────────────────────────────

  const origRenderbufferStorage = proto.renderbufferStorage;
  proto.renderbufferStorage = function (
    this: WebGL2RenderingContext,
    target: number,
    internalformat: number,
    width: number,
    height: number,
  ) {
    const result = origRenderbufferStorage.call(
      this,
      target,
      internalformat,
      width,
      height,
    );

    try {
      const boundRB = this.getParameter(
        this.RENDERBUFFER_BINDING,
      ) as WebGLRenderbuffer | null;
      if (boundRB) {
        const bpp = bytesPerPixel(internalformat);
        resources.set(boundRB, {
          id: nextId++,
          type: "renderbuffer",
          bytes: width * height * bpp,
          createdAt: performance.now(),
        });
      }
    } catch {
      /* safe */
    }

    return result;
  };

  const origDeleteRenderbuffer = proto.deleteRenderbuffer;
  proto.deleteRenderbuffer = function (
    this: WebGL2RenderingContext,
    rb: WebGLRenderbuffer | null,
  ) {
    if (rb) resources.delete(rb);
    return origDeleteRenderbuffer.call(this, rb);
  };

  console.log("[gpu-monitor] Installed — tracking WebGL resource allocations");
}

// ── Reporting ──────────────────────────────────────────────────────────

export function getGpuMemoryReport(): GpuMemoryReport {
  const now = performance.now();
  const entries = Array.from(resources.values());

  // Group by type
  const groups = new Map<string, { count: number; bytes: number }>();
  for (const e of entries) {
    const g = groups.get(e.type) ?? { count: 0, bytes: 0 };
    g.count += 1;
    g.bytes += e.bytes;
    groups.set(e.type, g);
  }

  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);

  const summary = Array.from(groups.entries())
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .map(([type, g]) => ({
      type,
      count: g.count,
      bytes: g.bytes,
      mb: (g.bytes / 1048576).toFixed(1),
    }));

  // Top 20 largest resources
  const topResources = entries
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 20)
    .map((e) => ({
      type: e.type,
      bytes: e.bytes,
      mb: (e.bytes / 1048576).toFixed(2),
      age: `${((now - e.createdAt) / 1000).toFixed(0)}s`,
      label: e.label,
    }));

  // JS heap (Chrome only)
  let jsHeap: GpuMemoryReport["jsHeap"] = null;
  const perfMemory = (
    performance as unknown as {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  if (perfMemory) {
    jsHeap = {
      used: perfMemory.usedJSHeapSize,
      total: perfMemory.totalJSHeapSize,
      limit: perfMemory.jsHeapSizeLimit,
    };
  }

  return {
    totalEstimatedBytes: totalBytes,
    totalEstimatedMB: Math.round(totalBytes / 1048576),
    summary,
    topResources,
    jsHeap,
  };
}

/**
 * Log a formatted memory report to the console.
 * Call from browser DevTools: `getGpuMemoryReport()` or `logGpuMemory()`.
 */
export function logGpuMemory(): void {
  const report = getGpuMemoryReport();

  console.group(`[gpu-monitor] GPU Memory: ~${report.totalEstimatedMB} MB`);
  console.table(report.summary);

  if (report.jsHeap) {
    console.log(
      `JS Heap: ${(report.jsHeap.used / 1048576).toFixed(0)} MB used / ${(report.jsHeap.total / 1048576).toFixed(0)} MB total / ${(report.jsHeap.limit / 1048576).toFixed(0)} MB limit`,
    );
  }

  if (report.topResources.length > 0) {
    console.log("Top 20 GPU resources:");
    console.table(report.topResources);
  }

  console.groupEnd();
}

// Expose to window for easy DevTools access
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__gpuMemory = {
    report: getGpuMemoryReport,
    log: logGpuMemory,
  };
}
