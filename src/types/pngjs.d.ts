// The part of pngjs that tools/model-sheet.ts uses.
declare module "pngjs" {
  export class PNG {
    constructor(options: { width: number; height: number });
    width: number;
    height: number;
    data: Buffer;
    pack(): NodeJS.ReadableStream;
  }
}
