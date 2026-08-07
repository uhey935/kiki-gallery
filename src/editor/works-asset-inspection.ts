import type { WorksAssetFormat } from "./works-asset-policy.ts";
import { WORKS_ASSET_MIME } from "./works-asset-policy.ts";

export type WorksAssetInspection = {
  format: WorksAssetFormat;
  mime: string;
  width: number;
  height: number;
  frameCount: number;
  animated: boolean;
};

function png(bytes: Uint8Array): WorksAssetInspection | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return;
  if (
    bytes.length < 45 ||
    Buffer.from(bytes.subarray(12, 16)).toString() !== "IHDR"
  )
    throw new Error("Malformed PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  let offset = 8;
  let animated = false;
  let frames = 1;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG");
    const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString();
    if (type === "acTL") {
      animated = true;
      frames = length >= 4 ? view.getUint32(offset + 8) : 2;
    }
    offset = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || offset !== bytes.length || width === 0 || height === 0)
    throw new Error("Malformed PNG");
  return {
    format: "png",
    mime: WORKS_ASSET_MIME.png,
    width,
    height,
    frameCount: frames,
    animated,
  };
}

function jpeg(bytes: Uint8Array): WorksAssetInspection | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("Malformed JPEG");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (offset !== bytes.length || !dimensions)
        throw new Error("Malformed JPEG");
      return {
        format: "jpg",
        mime: WORKS_ASSET_MIME.jpg,
        ...dimensions,
        frameCount: 1,
        animated: false,
      };
    }
    if (marker === 0xda) {
      let end = bytes.length - 2;
      while (end >= offset && !(bytes[end] === 0xff && bytes[end + 1] === 0xd9))
        end--;
      if (end < offset || end + 2 !== bytes.length || !dimensions)
        throw new Error("Malformed JPEG");
      return {
        format: "jpg",
        mime: WORKS_ASSET_MIME.jpg,
        ...dimensions,
        frameCount: 1,
        animated: false,
      };
    }
    if (offset + 2 > bytes.length) throw new Error("Truncated JPEG");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length)
      throw new Error("Truncated JPEG");
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (length < 7) throw new Error("Malformed JPEG");
      dimensions = {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  throw new Error("Truncated JPEG");
}

function webp(bytes: Uint8Array): WorksAssetInspection | undefined {
  const text = (start: number, end: number) =>
    Buffer.from(bytes.subarray(start, end)).toString();
  if (text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP") return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 30 || view.getUint32(4, true) + 8 !== bytes.length)
    throw new Error("Malformed WebP");
  const chunk = text(12, 16);
  let width: number;
  let height: number;
  let animated = false;
  if (chunk === "VP8X") {
    animated = (bytes[20] & 0x02) !== 0;
    width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
  } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    width = view.getUint16(26, true) & 0x3fff;
    height = view.getUint16(28, true) & 0x3fff;
  } else throw new Error("Malformed WebP");
  return {
    format: "webp",
    mime: WORKS_ASSET_MIME.webp,
    width,
    height,
    frameCount: animated ? 2 : 1,
    animated,
  };
}

function avif(bytes: Uint8Array): WorksAssetInspection | undefined {
  if (
    bytes.length < 16 ||
    Buffer.from(bytes.subarray(4, 8)).toString() !== "ftyp"
  )
    return;
  const brands = Buffer.from(
    bytes.subarray(8, Math.min(bytes.length, 40)),
  ).toString("latin1");
  if (!brands.includes("avif") && !brands.includes("avis")) return;
  let width = 0;
  let height = 0;
  for (let offset = 0; offset + 8 <= bytes.length; ) {
    const size = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      4,
    ).getUint32(0);
    if (size < 8 || offset + size > bytes.length)
      throw new Error("Malformed AVIF");
    offset += size;
  }
  for (let index = 4; index + 12 <= bytes.length; index++) {
    if (Buffer.from(bytes.subarray(index, index + 4)).toString() === "ispe") {
      const view = new DataView(bytes.buffer, bytes.byteOffset + index + 8, 8);
      width = view.getUint32(0);
      height = view.getUint32(4);
      break;
    }
  }
  if (!width || !height) throw new Error("Malformed AVIF");
  const animated = brands.includes("avis");
  return {
    format: "avif",
    mime: WORKS_ASSET_MIME.avif,
    width,
    height,
    frameCount: animated ? 2 : 1,
    animated,
  };
}

export function inspectWorksImage(bytes: Uint8Array): WorksAssetInspection {
  for (const inspect of [png, jpeg, webp, avif]) {
    const result = inspect(bytes);
    if (result) return result;
  }
  throw new Error("Unsupported or malformed image");
}
