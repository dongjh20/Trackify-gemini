export type ProjectGroup = {
  id: string;
  name: string;
  userId: string;
  order?: number;
  isExpanded?: boolean;
};

export type Project = {
  id: string;
  name: string;
  color: string;
  order?: number;
  groupId?: string | null;
};

export type TimeEntry = {
  id: string;
  description: string;
  projectId: string | null;
  startTime: number;
  endTime: number;
  duration: number;
  userId: string;
  deletedAt?: number;
  color?: string;
};

export type DeletedEntry = TimeEntry & {
  deletedAt: number;
};

export type ActiveTimer = {
  description: string;
  projectId: string | null;
  startTime: number;
  totalPausedTime: number;
  lastPauseTime: number | null;
  isPaused: boolean;
  isActive: boolean;
  userId: string;
  isIdle?: boolean;
  currentSegmentStartTime?: number;
  resumeTo?: {
    description: string;
    projectId: string | null;
  };
};
