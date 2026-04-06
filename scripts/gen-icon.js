// Generates assets/icon.png — a 256x256 dark circle with emerald play triangle
const { PNG } = require('pngjs')
const fs = require('fs')
const path = require('path')

const SIZE = 256
const png = new PNG({ width: SIZE, height: SIZE, filterType: -1 })

const cx = SIZE / 2
const cy = SIZE / 2
const outerR = SIZE * 0.46   // outer circle radius
const innerR = SIZE * 0.40   // inner circle (button face) radius

// Play triangle geometry (right-pointing)
const triLeft  = cx - SIZE * 0.14
const triRight = cx + SIZE * 0.20
const triHalf  = SIZE * 0.22   // half-height

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4
    const dx = x - cx
    const dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Default: transparent
    png.data[idx]     = 0
    png.data[idx + 1] = 0
    png.data[idx + 2] = 0
    png.data[idx + 3] = 0

    // Outer ring: emerald border
    if (dist < outerR && dist >= innerR) {
      png.data[idx]     = 0x34
      png.data[idx + 1] = 0xd3
      png.data[idx + 2] = 0x99
      png.data[idx + 3] = 255
    }

    // Inner circle: dark background
    if (dist < innerR) {
      png.data[idx]     = 0x0f
      png.data[idx + 1] = 0x0c
      png.data[idx + 2] = 0x29
      png.data[idx + 3] = 255
    }

    // Play triangle: inside inner circle, right-pointing
    if (dist < innerR) {
      const inTri = (
        x >= triLeft &&
        x <= triRight &&
        Math.abs(y - cy) <= triHalf * (triRight - x) / (triRight - triLeft)
      )
      if (inTri) {
        png.data[idx]     = 0x34
        png.data[idx + 1] = 0xd3
        png.data[idx + 2] = 0x99
        png.data[idx + 3] = 255
      }
    }
  }
}

const out = path.join(__dirname, '../assets/icon.png')
fs.writeFileSync(out, PNG.sync.write(png))
console.log('Icon written to', out)
