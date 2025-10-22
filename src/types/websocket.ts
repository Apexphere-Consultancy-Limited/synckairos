import { SyncState } from './session'

// Server → Client messages
export interface WSConnectedMessage {
  type: 'CONNECTED'
  sessionId: string
  timestamp: number
}

export interface WSStateUpdateMessage {
  type: 'STATE_UPDATE'
  sessionId: string
  timestamp: number
  state: SyncState
}

export interface WSStateSyncMessage {
  type: 'STATE_SYNC'
  sessionId: string
  timestamp: number
  state: SyncState
}

export interface WSSessionDeletedMessage {
  type: 'SESSION_DELETED'
  sessionId: string
  timestamp: number
}

export interface WSPongMessage {
  type: 'PONG'
  timestamp: number
}

export interface WSErrorMessage {
  type: 'ERROR'
  code: string
  message: string
}

export type ServerMessage =
  | WSConnectedMessage
  | WSStateUpdateMessage
  | WSStateSyncMessage
  | WSSessionDeletedMessage
  | WSPongMessage
  | WSErrorMessage

// Client → Server messages
export interface WSPingMessage {
  type: 'PING'
}

export interface WSReconnectMessage {
  type: 'RECONNECT'
}

export type ClientMessage = WSPingMessage | WSReconnectMessage

// Extended WebSocket interface with custom properties
export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean
  sessionId: string
}
