
export enum MessageSender {
  USER = 'user',
  BOT = 'bot',
}

export interface ChatMessage {
  sender: MessageSender;
  text: string;
}
