import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export interface UserSummary {
  _id: string;
  name: string;
  email: string;
  language?: string;
  title?: string;
  avatar?: string;
  isSystemAdmin?: boolean;
}
export interface WorkspaceSummary { _id: string; name: string; plan?: string; isMentor?: boolean; role: WorkspaceRole }
export interface ProjectSummary {
  _id: string;
  name: string;
  color: 'blue' | 'purple' | 'emerald' | 'amber' | 'rose' | 'slate' | 'cyan';
  status: 'active' | 'archived';
  projectRole: 'pm' | 'member' | 'viewer';
}
export interface WorkspaceSnapshot { workspace: WorkspaceSummary; role: WorkspaceRole; projects: ProjectSummary[] }
export interface AppContextValue {
  me: UserSummary | null | undefined;
  setMe: (user: UserSummary | null) => void;
  loadMe: () => Promise<unknown>;
  offline: boolean;
  workspaces: WorkspaceSummary[];
  wsId: string | null;
  setWsId: (id: string) => void;
  ws: WorkspaceSnapshot | null;
  role: WorkspaceRole | undefined;
  projects: ProjectSummary[];
  activeProjects: ProjectSummary[];
  project: ProjectSummary | null | undefined;
  setProjectId: (id: string | null) => void;
  reloadWorkspace: () => Promise<unknown>;
  wsError: unknown;
  unread: number;
  setUnread: Dispatch<SetStateAction<number>>;
  refreshUnread: () => Promise<void>;
  logout: () => Promise<void>;
  theme: string;
  toggleTheme: () => void;
  canWriteProject: boolean | null | undefined;
  canManageProject: boolean | null | undefined;
}

export const AppCtx = createContext<AppContextValue | null>(null);
export function useApp(): AppContextValue {
  const value = useContext(AppCtx);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
