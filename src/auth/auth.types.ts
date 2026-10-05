import type { Request } from 'express';

export interface User {
  id: string;
  name: string;
  email: string;
}
export interface SessionClaims {
  sub: string;
  sid: string;
}
export interface AuthenticatedRequest extends Request {
  user: User;
  sessionId: string;
}
