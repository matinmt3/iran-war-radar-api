declare module "telegram" {
  export const TelegramClient: any;
  export const Api: any;
  export namespace sessions { const StringSession: any; }
}
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(filename: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
  export class StatementSync {
    all(...params: any[]): any[];
    get(...params: any[]): any;
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  }
}
declare module "supertest" {
  const request: any;
  export default request;
}
