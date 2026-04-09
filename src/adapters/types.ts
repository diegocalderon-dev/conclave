export interface Adapter {
  name: string;
  detect(): Promise<DetectResult>;
  invoke(prompt: string, options: InvokeOptions): Promise<AdapterResponse>;
}

export interface DetectResult {
  available: boolean;
  version?: string;
  error?: string;
}

export interface InvokeOptions {
  workdir?: string;
  timeout?: number; // ms, default 300_000
  allowWrites?: boolean;
}

export interface AdapterResponse {
  content: string;
  durationMs: number;
  exitCode: number;
  error?: string;
}
