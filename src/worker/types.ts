export interface PaneContent {
  html: string;
  title: string;
  updatedAt: number;
}

export interface SessionState {
  totpSecret: Uint8Array;
  cookieKey: string;
  panes: Map<string, PaneContent>;
  apiKey: string;
}

export interface WsMessage {
  type: 'pane_update' | 'pane_close' | 'session_end' | 'action';
  pane?: string;
  content?: PaneContent;
  action?: { type: string; id: string; data?: Record<string, unknown> };
}

export interface AuthVerifyRequest {
  code: string;
}

export interface AuthVerifyResponse {
  ok: boolean;
  error?: string;
}

export interface FailedAttempt {
  count: number;
  lockedUntil: number;
}

export interface Env {
  HOTLINE_SESSION: DurableObjectNamespace;
  ENVIRONMENT: string;
}
