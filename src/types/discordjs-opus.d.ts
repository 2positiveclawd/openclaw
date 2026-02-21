/**
 * Ambient type declarations for @discordjs/opus.
 *
 * Provides minimal types when the optional dependency is not installed.
 */
declare module "@discordjs/opus" {
  export class OpusEncoder {
    constructor(samplingRate: number, channels: number);
    encode(buffer: Buffer): Buffer;
    decode(buffer: Buffer): Buffer;
  }
}
