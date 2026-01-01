export type BloomerangTask = {
  id: number;
  accountId: number | null;
  dueDate: string | null;
  subject: string | null;
  note: string | null;
  channel: string | null;
  purpose: string | null;
  status: string | null;
  createdDate?: string | null;
  lastModifiedDate?: string | null;
  ownerUserId?: number | null;
  raw?: Record<string, unknown>;
};

export type CreateTaskPayload = {
  accountId: number;
  dueDate: string;
  subject: string;
  note?: string | null;
  channel?: string | null;
  purpose?: string | null;
  userId?: number | null;
};

export type UpdateTaskPayload = Partial<Pick<CreateTaskPayload, 'dueDate' | 'subject' | 'note' | 'channel' | 'purpose' | 'userId'>>;
