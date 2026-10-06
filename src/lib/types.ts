export type Role = 'admin' | 'boss' | 'executor'

export type TaskStatus = 'new' | 'in_progress' | 'waiting' | 'done' | 'cancelled'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export type AttachmentKind = 'problem' | 'solution' | 'other'

export interface Profile {
  id: string
  full_name: string
  username: string | null
  role: Role
  created_at: string
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  classroom: string | null
  computer: string | null
  created_by: string
  assigned_to: string | null
  created_at: string
  updated_at: string
  // joined (optional)
  creator?: Profile | null
  assignee?: Profile | null
}

export interface Comment {
  id: string
  task_id: string
  author_id: string
  body: string
  created_at: string
  author?: Profile | null
}

export interface Attachment {
  id: string
  task_id: string
  comment_id: string | null
  storage_path: string
  url: string
  kind: AttachmentKind
  uploaded_by: string
  created_at: string
  uploader?: Profile | null
}

export const TASK_STATUSES: TaskStatus[] = [
  'new',
  'in_progress',
  'waiting',
  'done',
  'cancelled',
]

export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

export const ATTACHMENT_KINDS: AttachmentKind[] = [
  'problem',
  'solution',
  'other',
]
