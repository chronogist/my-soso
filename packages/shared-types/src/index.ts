export type Channel = 'telegram' | 'discord' | 'whatsapp';

export type ResponseClass =
  | 'market_info'
  | 'education'
  | 'personalized_analysis'
  | 'recommendation'
  | 'execution';

export interface AgentRequest {
  userId: string;
  channel: Channel;
  externalUserId: string;
  conversationId: string;
  text: string;
  idempotencyKey: string;
}

export interface AgentResponseButton {
  id: string;
  label: string;
  style?: 'primary' | 'danger';
}

export interface AgentResponseAttachment {
  kind: 'memo' | 'chart';
  payload: unknown;
}

export interface AgentResponse {
  text: string;
  buttons?: AgentResponseButton[];
  attachments?: AgentResponseAttachment[];
  classification: ResponseClass;
}
