/**
 * Ambient type declarations for @discordjs/voice.
 *
 * These types are only used when the optional dependency is not installed.
 * When @discordjs/voice is installed, its bundled types take precedence.
 */
declare module "@discordjs/voice" {
  import type { Readable } from "node:stream";

  export enum AudioPlayerStatus {
    Idle = "idle",
    Buffering = "buffering",
    Playing = "playing",
    AutoPaused = "autopaused",
    Paused = "paused",
  }

  export enum VoiceConnectionStatus {
    Signalling = "signalling",
    Connecting = "connecting",
    Ready = "ready",
    Disconnected = "disconnected",
    Destroyed = "destroyed",
  }

  export enum EndBehaviorType {
    Manual = 0,
    AfterSilence = 1,
    AfterInactivity = 2,
  }

  export interface AudioPlayer {
    state: { status: AudioPlayerStatus };
    play(resource: AudioResource): void;
    stop(force?: boolean): boolean;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export interface AudioResource {
    // opaque
  }

  export interface VoiceConnectionReceiver {
    speaking: {
      on(event: "start", listener: (userId: string) => void): unknown;
    };
    subscribe(
      userId: string,
      opts?: { end?: { behavior: EndBehaviorType; duration: number } },
    ): Readable;
  }

  export interface VoiceConnection {
    receiver: VoiceConnectionReceiver;
    subscribe(player: AudioPlayer): unknown;
    destroy(): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export function createAudioPlayer(): AudioPlayer;
  export function createAudioResource(input: string | Readable): AudioResource;
  export function joinVoiceChannel(options: {
    channelId: string;
    guildId: string;
    adapterCreator: unknown;
    selfDeaf?: boolean;
    selfMute?: boolean;
  }): VoiceConnection;
  export function entersState<T>(target: T, status: string, timeout: number): Promise<T>;
}
