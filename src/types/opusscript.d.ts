/**
 * Ambient type declarations for opusscript.
 *
 * Provides minimal types when the optional dependency is not installed.
 */
declare module "opusscript" {
  class OpusScript {
    static Application: {
      VOIP: number;
      AUDIO: number;
      RESTRICTED_LOWDELAY: number;
    };
    constructor(samplingRate: number, channels: number, application?: number);
    encode(buffer: Buffer, frameSize?: number): Buffer;
    decode(buffer: Buffer): Buffer;
    delete(): void;
  }

  export = OpusScript;
}
