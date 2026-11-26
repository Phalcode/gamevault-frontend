export interface GameVaultConfig {
  gameid?: number;
  /** UUID of the server that installed this version. */
  serveruuid?: string;
  /** Normalized URL of the server that installed this version. */
  serverurl?: string;
  versionid?: number;
  gametype?: string;
  downloadfinished: boolean;
  extractionfinished: boolean;
  installationfinished?: boolean;
  downloadprogress: string;
  launchexecutable?: string;
  launchparameters?: string;
  launchasadmin?: boolean;
  umugameid?: string;
  umustore?: string;
  umuprotonpath?: string;
  umuwineprefix?: string;
  /** Runs the game through umu-launcher even when it is not a Windows exe. */
  forceumu?: boolean;
}
