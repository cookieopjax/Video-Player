// Apple liquid glass style icon — 256x256 dark squircle with white play arrow
const { PNG } = require('pngjs')
const fs = require('fs'), path = require('path')

const S = 256
const png = new PNG({ width: S, height: S, filterType: -1 })
png.data.fill(0)

const cx = S / 2, cy = S / 2
const R  = S * 0.44   // squircle "radius"
const N  = 5          // squircle exponent (higher = more square)

// Anti-aliased squircle coverage for pixel (px, py) at squircle radius r
function sqCov(px, py, r) {
  let c = 0, K = 4
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
    const dx = (px + (i + 0.5) / K - 0.5 - cx) / r
    const dy = (py + (j + 0.5) / K - 0.5 - cy) / r
    if (Math.pow(Math.abs(dx), N) + Math.pow(Math.abs(dy), N) <= 1) c++
  }
  return c / (K * K)
}

// Alpha composite src over dst in place
function blend(x, y, r, g, b, a) {
  if (x < 0 || x >= S || y < 0 || y >= S) return
  const i = (y * S + x) * 4
  const sa = a / 255, da = png.data[i + 3] / 255
  const oa = sa + da * (1 - sa)
  if (oa < 1e-4) return
  png.data[i]     = Math.round((r * sa + png.data[i]     * da * (1 - sa)) / oa)
  png.data[i + 1] = Math.round((g * sa + png.data[i + 1] * da * (1 - sa)) / oa)
  png.data[i + 2] = Math.round((b * sa + png.data[i + 2] * da * (1 - sa)) / oa)
  png.data[i + 3] = Math.round(oa * 255)
}

// 1. Background gradient (dark blue-gray, lighter at top)
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const c = sqCov(x, y, R); if (!c) continue
  const t = (y - cy + R) / (2 * R)          // 0 = top, 1 = bottom
  const br = Math.round(44 - 18 * t)         // 44 → 26
  blend(x, y, br, br, Math.round(58 - 22 * t), Math.round(c * 255))
}

// 2. Soft specular highlight — top-left area
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const c = sqCov(x, y, R); if (!c) continue
  const dx = x - (cx - R * 0.38), dy = y - (cy - R * 0.62)
  const dist = Math.sqrt(dx * dx + dy * dy) / (R * 0.82)
  const hi = Math.max(0, 1 - dist) * 0.20
  if (hi < 0.003) continue
  blend(x, y, 200, 215, 255, Math.round(hi * c * 255))
}

// 3. Inner edge highlight — bright rim at top of squircle
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const outer = sqCov(x, y, R)
  const inner = sqCov(x, y, R - 2)
  const edge = outer - inner; if (edge < 0.01) continue
  // Bias toward top half (angle from center: up = bright)
  const ang = Math.atan2(y - cy, x - cx)
  const bias = Math.max(0, -Math.sin(ang) * 0.65 + 0.35)
  blend(x, y, 255, 255, 255, Math.round(edge * bias * 160))
}

// 4. Play triangle — white, optically centered
const tw = S * 0.29, th = S * 0.35
const ox = cx + S * 0.04   // slight right offset for optical balance
// Vertices
const ax = ox - tw * 0.44, ay = cy - th * 0.5   // top-left
const bx = ox - tw * 0.44, by = cy + th * 0.5   // bottom-left
const ex = ox + tw * 0.56, ey = cy               // right tip

function triCov(px, py) {
  let c = 0, K = 4
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
    const sx = px + (i + 0.5) / K - 0.5
    const sy = py + (j + 0.5) / K - 0.5
    const d1 = (sx - ax) * (by - ay) - (bx - ax) * (sy - ay)
    const d2 = (sx - bx) * (ey - by) - (ex - bx) * (sy - by)
    const d3 = (sx - ex) * (ay - ey) - (ax - ex) * (sy - ey)
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) c++
  }
  return c / (K * K)
}

for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  if (!sqCov(x, y, R)) continue
  const tc = triCov(x, y); if (!tc) continue
  // Subtle inner gradient (lighter toward top-left of triangle)
  const gd = 1 - Math.max(0, Math.min(0.12, ((x - ax) / tw * 0.06 + (y - ay) / th * 0.06)))
  blend(x, y, 255, 255, 255, Math.round(tc * gd * 238))
}

const out = path.join(__dirname, '..', 'assets', 'icon.png')
fs.writeFileSync(out, PNG.sync.write(png))
console.log('Icon written:', out)
