export interface GameVaultConfig {
  versionid?: number;
  gametype?: string;
  downloadfinished: boolean;
  extractionfinished: boolean;
  installationfinished?: boolean;
  downloadprogress: string;
  launchexecutable?: string;
  launchparameters?: string;
  launchasadmin?: boolean;
}
