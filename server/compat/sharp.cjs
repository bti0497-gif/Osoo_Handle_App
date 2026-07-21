const Jimp = require('jimp');

class JimpSharpPipeline {
  constructor(input, options = {}) {
    if (options.raw) {
      const { width, height, channels = 4 } = options.raw;
      const source = Buffer.from(input);
      let data = source;
      if (channels === 3) {
        data = Buffer.alloc(width * height * 4);
        for (let sourceIndex = 0, targetIndex = 0; sourceIndex < source.length; sourceIndex += 3, targetIndex += 4) {
          data[targetIndex] = source[sourceIndex];
          data[targetIndex + 1] = source[sourceIndex + 1];
          data[targetIndex + 2] = source[sourceIndex + 2];
          data[targetIndex + 3] = 255;
        }
      }
      this.imagePromise = Promise.resolve(new Jimp({
        data,
        width,
        height,
      }));
    } else {
      this.imagePromise = Jimp.read(input);
    }
    this.outputMime = Jimp.MIME_JPEG;
  }

  chain(transform) {
    this.imagePromise = this.imagePromise.then((image) => {
      transform(image);
      return image;
    });
    return this;
  }

  rotate(angle) {
    return Number.isFinite(angle) ? this.chain((image) => image.rotate(angle)) : this;
  }

  resize(options = {}) {
    const width = Math.max(1, Math.round(Number(options.width) || 1));
    const height = Math.max(1, Math.round(Number(options.height) || 1));
    return this.chain((image) => {
      if (options.withoutEnlargement && image.bitmap.width <= width && image.bitmap.height <= height) return;
      if (options.fit === 'inside') image.scaleToFit(width, height);
      else if (options.fit === 'contain') image.contain(width, height);
      else image.cover(width, height);
    });
  }

  flatten({ background = '#ffffff' } = {}) {
    return this.chain((image) => {
      const canvas = new Jimp(image.bitmap.width, image.bitmap.height, Jimp.cssColorToHex(background));
      canvas.composite(image, 0, 0);
      image.bitmap = canvas.bitmap;
    });
  }

  jpeg({ quality = 90 } = {}) {
    this.outputMime = Jimp.MIME_JPEG;
    return this.chain((image) => image.quality(quality));
  }

  png() {
    this.outputMime = Jimp.MIME_PNG;
    return this;
  }

  async toBuffer(options = {}) {
    const image = await this.imagePromise;
    const data = await image.getBufferAsync(this.outputMime);
    if (options.resolveWithObject) {
      return { data, info: { width: image.bitmap.width, height: image.bitmap.height } };
    }
    return data;
  }

  async toFile(filePath) {
    const image = await this.imagePromise;
    if (this.outputMime === Jimp.MIME_JPEG) image.quality(90);
    await image.writeAsync(filePath);
    return { width: image.bitmap.width, height: image.bitmap.height };
  }
}

function sharpCompat(input, options) {
  return new JimpSharpPipeline(input, options);
}

module.exports = sharpCompat;
