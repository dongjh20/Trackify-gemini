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
};

export type ActiveTimer = {
  description: string;
  projectId: string | null;
  startTime: number;
  totalPausedTime: number;
  lastPauseTime: number | null;
  isPaused: boolean;
};
