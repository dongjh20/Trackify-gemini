import { TimeEntry, Project } from './types';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function groupByDay(entries: TimeEntry[]) {
  const groups: Record<string, TimeEntry[]> = {};
  entries.forEach(entry => {
    const d = new Date(entry.startTime);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups[dateStr]) {
      groups[dateStr] = [];
    }
    groups[dateStr].push(entry);
  });
  return groups;
}

export function fillGapsWithIdle(entries: TimeEntry[], idleProject: Project | undefined): TimeEntry[] {
  if (!idleProject || entries.length === 0) return entries;
  
  // Sort entries by start time
  const sorted = [...entries].sort((a, b) => a.startTime - b.startTime);
  const result: TimeEntry[] = [];
  
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    
    // If there's a gap between previous entry and current one
    if (i > 0) {
      const previous = sorted[i - 1];
      const gap = current.startTime - previous.endTime;
      
      // If gap is more than 1 minute (60000ms)
      if (gap > 60000) {
        result.push({
          id: `idle-${previous.endTime}`,
          description: 'Idle',
          projectId: idleProject.id,
          startTime: previous.endTime,
          endTime: current.startTime,
          duration: gap,
          userId: current.userId
        } as TimeEntry);
      }
    }
    
    result.push(current);
  }
  
  return result;
}
