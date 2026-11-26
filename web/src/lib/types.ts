export type Role = "admin" | "manager" | "member";
export type Status = "backlog" | "todo" | "in_progress" | "review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface UserLite {
  _id: string;
  name: string;
  avatarColor?: string;
  email?: string;
  title?: string;
  role?: Role;
}
export interface User extends UserLite {
  email: string;
  role: Role;
  hourlyRate?: number;
  weeklyCapacity?: number;
  active?: boolean;
  org: string;
}
export interface Org {
  _id: string;
  name: string;
  slug: string;
  currency: string;
  defaultHourlyRate: number;
}
export interface ClientT {
  _id: string;
  name: string;
  industry?: string;
  website?: string;
  status: "lead" | "active" | "paused" | "churned";
  hourlyRate?: number;
  notes?: string;
  owner?: UserLite;
  projectCount?: number;
  activeProjects?: number;
  contactCount?: number;
  hours?: number;
  billableHours?: number;
}
export interface Contact {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  isPrimary?: boolean;
}
export interface ProjectStats {
  taskCount: number;
  doneCount: number;
  overdueCount: number;
  progress: number;
  hoursLogged: number;
}
export interface Project extends Partial<ProjectStats> {
  _id: string;
  name: string;
  key: string;
  description?: string;
  status: "planning" | "active" | "on_hold" | "completed" | "archived";
  color: string;
  client?: { _id: string; name: string; hourlyRate?: number } | null;
  owner?: UserLite;
  members?: UserLite[];
  startDate?: string;
  dueDate?: string;
  budgetHours?: number;
  billable?: boolean;
  hourlyRate?: number;
}
export interface Subtask {
  _id: string;
  title: string;
  done: boolean;
}
export interface Attachment {
  _id: string;
  name: string;
  url?: string;
  size?: number;
  mimeType?: string;
  uploadedAt?: string;
}
export interface Task {
  _id: string;
  number: number;
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  order: number;
  project: { _id: string; name: string; key: string; color: string } | string;
  assignee?: UserLite | null;
  reporter?: UserLite | null;
  dueDate?: string | null;
  estimateHours?: number | null;
  labels: string[];
  subtasks: Subtask[];
  attachments: Attachment[];
  completedAt?: string;
  createdAt: string;
  commentCount?: number;
  loggedMinutes?: number;
}
export interface Comment {
  _id: string;
  body: string;
  author: UserLite;
  createdAt: string;
}
export interface TimeEntry {
  _id: string;
  user: UserLite;
  task?: { _id: string; title: string; number: number } | null;
  project: { _id: string; name: string; key: string; color: string };
  client?: { _id: string; name: string } | null;
  description?: string;
  startedAt: string;
  endedAt?: string | null;
  minutes: number;
  billable: boolean;
  source: "timer" | "manual";
}
export interface TaskDetail extends Task {
  comments: Comment[];
  timeEntries: TimeEntry[];
}
export interface Notification {
  _id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: string;
}
export interface Activity {
  _id: string;
  actor?: UserLite;
  verb: string;
  summary: string;
  project?: string;
  task?: string;
  createdAt: string;
}

export const STATUSES: { id: Status; label: string; dot: string }[] = [
  { id: "backlog", label: "Backlog", dot: "bg-slate-400" },
  { id: "todo", label: "To do", dot: "bg-sky-500" },
  { id: "in_progress", label: "In progress", dot: "bg-amber-500" },
  { id: "review", label: "Review", dot: "bg-violet-500" },
  { id: "done", label: "Done", dot: "bg-emerald-500" },
];
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];
