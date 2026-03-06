import React, { useState, useEffect } from 'react';
import { ActiveTimer } from '../types';
import { formatDuration } from '../utils';

interface Props {
  activeTimer: ActiveTimer | null;
  className?: string;
}

export function TimerDisplay({ activeTimer, className = "" }: Props) {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!activeTimer) {
      setDuration(0);
      return;
    }

    const updateDuration = () => {
      let current = Date.now() - activeTimer.startTime - activeTimer.totalPausedTime;
      if (activeTimer.isPaused && activeTimer.lastPauseTime) {
        current -= (Date.now() - activeTimer.lastPauseTime);
      }
      setDuration(Math.max(0, current));
    };

    updateDuration();
    
    if (!activeTimer.isPaused) {
      const interval = setInterval(updateDuration, 1000);
      return () => clearInterval(interval);
    }
  }, [activeTimer]);

  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {formatDuration(duration)}
    </span>
  );
}
