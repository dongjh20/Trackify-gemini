export type Project = {
  id: string;
  name: string;
  color: string;
};

export type TimeEntry = {
  id: string;
  description: string;
  projectId: string | null;
  startTime: number;
  endTime: number;
  duration: number;
  userId: string;
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
  resumeTo?: {
    description: string;
    projectId: string | null;
  };
};
