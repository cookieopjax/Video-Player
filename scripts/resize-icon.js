// Resize source PNG to 256x256 using bilinear interpolation
const { PNG } = require('pngjs')
const fs = require('fs')
const path = require('path')

const srcPath  = process.argv[2]
const destPath = process.argv[3] || path.join(__dirname, '..', 'assets', 'icon.png')
const TARGET   = 256

const src = PNG.sync.read(fs.readFileSync(srcPath))
const out = new PNG({ width: TARGET, height: TARGET, filterType: -1 })

for (let y = 0; y < TARGET; y++) {
  for (let x = 0; x < TARGET; x++) {
    const sx = (x / TARGET) * src.width
    const sy = (y / TARGET) * src.height
    const x0 = Math.min(Math.floor(sx), src.width  - 1)
    const y0 = Math.min(Math.floor(sy), src.height - 1)
    const x1 = Math.min(x0 + 1, src.width  - 1)
    const y1 = Math.min(y0 + 1, src.height - 1)
    const fx = sx - x0, fy = sy - y0
    const i00 = (y0 * src.width + x0) * 4
    const i10 = (y0 * src.width + x1) * 4
    const i01 = (y1 * src.width + x0) * 4
    const i11 = (y1 * src.width + x1) * 4
    const di  = (y  * TARGET   + x)  * 4
    for (let c = 0; c < 4; c++) {
      out.data[di + c] = Math.round(
        src.data[i00 + c] * (1 - fx) * (1 - fy) +
        src.data[i10 + c] * fx       * (1 - fy) +
        src.data[i01 + c] * (1 - fx) * fy       +
        src.data[i11 + c] * fx       * fy
      )
    }
  }
}

fs.writeFileSync(destPath, PNG.sync.write(out))
console.log(`Icon saved to ${destPath} (${TARGET}x${TARGET})`)
