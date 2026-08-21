import { WASocket, proto } from 'baileys'

export interface Command {
  name: string;
  description: string;
  alias?: string[];   
  adminOnly?: boolean;
  execute: (sock: WASocket, msg: proto.IWebMessageInfo, args: string[]) => Promise<void>;
}
