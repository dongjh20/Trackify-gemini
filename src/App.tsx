import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Minimize2, Maximize2, Clock, List, BarChart2, Settings, MoreVertical, Plus, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Project, TimeEntry, ActiveTimer } from './types';
import { formatDuration, formatTime, formatDateStr, groupByDay } from './utils';
import { ProjectSelector } from './components/ProjectSelector';
import { TimerDisplay } from './components/TimerDisplay';

type View = 'tracker' | 'projects' | 'reports';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('tracker');
  const [projects, setProjects] = useState<Project[]>([
    { id: '1', name: 'Design', color: '#3b82f6' },
    { id: '2', name: 'Development', color: '#10b981' },
    { id: '3', name: 'Meeting', color: '#f59e0b' },
    { id: '4', name: 'Admin', color: '#8b5cf6' },
  ]);
  
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  
  // Draft state for when timer is NOT running
  const [draftDescription, setDraftDescription] = useState('');
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  
  const [isCompactMode, setIsCompactMode] = useState(false);
  const [expandedReportProjects, setExpandedReportProjects] = useState<string[]>([]);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    const handleClickOutside = () => setOpenDropdownId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const toggleReportProject = (id: string) => {
    setExpandedReportProjects(prev =>
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const handleAddProject = (name: string, color: string) => {
    const newProject: Project = {
      id: crypto.randomUUID(),
      name,
      color
    };
    setProjects([...projects, newProject]);
    
    // Automatically select the new project if we are in the tracker
    if (activeTimer) {
      updateActiveTimer({ projectId: newProject.id });
    } else {
      setDraftProjectId(newProject.id);
    }
  };

  const handleDeleteProject = (id: string) => {
    setProjects(projects.filter(p => p.id !== id));
    setEntries(entries.map(e => e.projectId === id ? { ...e, projectId: null } : e));
    if (draftProjectId === id) setDraftProjectId(null);
    if (activeTimer?.projectId === id) updateActiveTimer({ projectId: null });
  };

  const handleDeleteEntry = (id: string) => {
    setEntries(entries.filter(e => e.id !== id));
  };

  const handleStart = () => {
    if (activeTimer) return;
    setActiveTimer({
      description: draftDescription,
      projectId: draftProjectId,
      startTime: Date.now(),
      totalPausedTime: 0,
      lastPauseTime: null,
      isPaused: false,
    });
    setDraftDescription('');
    setDraftProjectId(null);
  };

  const handlePause = () => {
    if (activeTimer && !activeTimer.isPaused) {
      setActiveTimer({
        ...activeTimer,
        isPaused: true,
        lastPauseTime: Date.now(),
      });
    }
  };

  const handleResume = () => {
    if (activeTimer && activeTimer.isPaused && activeTimer.lastPauseTime) {
      const pausedDuration = Date.now() - activeTimer.lastPauseTime;
      setActiveTimer({
        ...activeTimer,
        isPaused: false,
        totalPausedTime: activeTimer.totalPausedTime + pausedDuration,
        lastPauseTime: null,
      });
    }
  };

  const handleStop = () => {
    if (activeTimer) {
      const endTime = Date.now();
      let finalDuration = endTime - activeTimer.startTime - activeTimer.totalPausedTime;
      if (activeTimer.isPaused && activeTimer.lastPauseTime) {
        finalDuration -= (endTime - activeTimer.lastPauseTime);
      }
      
      const newEntry: TimeEntry = {
        id: crypto.randomUUID(),
        description: activeTimer.description,
        projectId: activeTimer.projectId,
        startTime: activeTimer.startTime,
        endTime: activeTimer.isPaused && activeTimer.lastPauseTime ? activeTimer.lastPauseTime : endTime,
        duration: finalDuration,
      };
      
      setEntries([newEntry, ...entries]);
      setDraftProjectId(activeTimer.projectId); // Remember the project for the next entry
      setActiveTimer(null);
    }
  };

  const updateActiveTimer = (updates: Partial<ActiveTimer>) => {
    if (activeTimer) {
      setActiveTimer({ ...activeTimer, ...updates });
    }
  };

  const groupedEntries = groupByDay(entries);

  if (isCompactMode) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-200">
          <div className="bg-gray-50 px-4 py-2 flex justify-between items-center border-b border-gray-200 cursor-move rounded-t-xl">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-blue-500" />
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Mini Tracker</span>
            </div>
            <button onClick={() => setIsCompactMode(false)} className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded hover:bg-gray-200">
              <Maximize2 size={14} />
            </button>
          </div>
          
          <div className="p-5 flex flex-col gap-4">
            <input 
              type="text"
              placeholder="What are you working on?"
              className="w-full text-lg border-none focus:ring-0 p-0 placeholder-gray-400 text-gray-800 outline-none"
              value={activeTimer ? activeTimer.description : draftDescription}
              onChange={(e) => activeTimer ? updateActiveTimer({ description: e.target.value }) : setDraftDescription(e.target.value)}
            />
            
            <div className="flex items-center justify-between">
              <ProjectSelector 
                projects={projects}
                selectedProjectId={activeTimer ? activeTimer.projectId : draftProjectId}
                onChange={(id) => activeTimer ? updateActiveTimer({ projectId: id }) : setDraftProjectId(id)}
                onAddProject={handleAddProject}
                compact
              />
              
              <div className="flex items-center gap-4">
                <TimerDisplay activeTimer={activeTimer} className={`text-xl ${activeTimer?.isPaused ? 'text-gray-400' : 'text-gray-800'}`} />
                
                <div className="flex items-center gap-2">
                  {!activeTimer ? (
                    <button onClick={handleStart} className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105">
                      <Play size={18} className="ml-1" />
                    </button>
                  ) : (
                    <>
                      {activeTimer.isPaused ? (
                        <button onClick={handleResume} className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105">
                          <Play size={18} className="ml-1" />
                        </button>
                      ) : (
                        <button onClick={handlePause} className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105">
                          <Pause size={18} />
                        </button>
                      )}
                      <button onClick={handleStop} className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105">
                        <Square size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-gray-50 text-gray-800 font-sans">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-gray-200">
          <div className="flex items-center gap-2 text-blue-600 font-bold text-lg tracking-tight">
            <Clock size={24} />
            <span>Trackify</span>
          </div>
        </div>
        <nav className="flex-1 py-4 px-2 flex flex-col gap-1">
          <button 
            onClick={() => setCurrentView('tracker')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors ${currentView === 'tracker' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Clock size={18} /> Time Tracker
          </button>
          <button 
            onClick={() => setCurrentView('projects')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors ${currentView === 'projects' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <List size={18} /> Projects
          </button>
          <button 
            onClick={() => setCurrentView('reports')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors ${currentView === 'reports' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <BarChart2 size={18} /> Reports
          </button>
        </nav>
        <div className="p-4 border-t border-gray-200">
          <button className="flex items-center gap-3 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors w-full text-left">
            <Settings size={18} /> Settings
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {currentView === 'tracker' && (
          <>
            {/* Topbar / Timer Bar */}
            <header className="bg-white border-b border-gray-200 shadow-sm z-10">
              <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
                <input 
                  type="text"
                  placeholder="What are you working on?"
                  className="flex-1 text-base border-none focus:ring-0 p-0 placeholder-gray-400 bg-transparent outline-none"
                  value={activeTimer ? activeTimer.description : draftDescription}
                  onChange={(e) => activeTimer ? updateActiveTimer({ description: e.target.value }) : setDraftDescription(e.target.value)}
                />
                
                <div className="flex items-center gap-6">
                  <ProjectSelector 
                    projects={projects}
                    selectedProjectId={activeTimer ? activeTimer.projectId : draftProjectId}
                    onChange={(id) => activeTimer ? updateActiveTimer({ projectId: id }) : setDraftProjectId(id)}
                    onAddProject={handleAddProject}
                  />
                  
                  <div className="h-6 w-px bg-gray-200"></div>
                  
                  <TimerDisplay activeTimer={activeTimer} className={`text-xl w-24 text-right ${activeTimer?.isPaused ? 'text-gray-400' : 'text-gray-800'}`} />
                  
                  <div className="flex items-center gap-2">
                    {!activeTimer ? (
                      <button onClick={handleStart} className="w-24 h-10 rounded bg-blue-500 hover:bg-blue-600 text-white font-medium flex items-center justify-center transition-colors cursor-pointer">
                        START
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        {activeTimer.isPaused ? (
                          <button onClick={handleResume} className="w-12 h-10 rounded bg-blue-100 hover:bg-blue-200 text-blue-600 flex items-center justify-center transition-colors cursor-pointer">
                            <Play size={18} className="ml-1" />
                          </button>
                        ) : (
                          <button onClick={handlePause} className="w-12 h-10 rounded bg-amber-100 hover:bg-amber-200 text-amber-600 flex items-center justify-center transition-colors cursor-pointer">
                            <Pause size={18} />
                          </button>
                        )}
                        <button onClick={handleStop} className="w-24 h-10 rounded bg-red-500 hover:bg-red-600 text-white font-medium flex items-center justify-center transition-colors cursor-pointer">
                          STOP
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <button 
                    onClick={() => setIsCompactMode(true)}
                    className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors cursor-pointer"
                    title="Mini Tracker"
                  >
                    <Minimize2 size={18} />
                  </button>
                </div>
              </div>
            </header>

            {/* Entries List */}
            <div className="flex-1 overflow-y-auto p-6 pb-32 bg-gray-50">
              <div className="max-w-5xl mx-auto flex flex-col gap-6">
                {Object.keys(groupedEntries).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <Clock size={48} className="mb-4 opacity-20" />
                    <p className="text-lg">No time entries yet</p>
                    <p className="text-sm">Start the timer to track your time</p>
                  </div>
                ) : (
                  Object.entries(groupedEntries).sort(([dateA], [dateB]) => new Date(dateB).getTime() - new Date(dateA).getTime()).map(([date, dayEntries]) => {
                    const dayTotal = dayEntries.reduce((acc, entry) => acc + entry.duration, 0);
                    
                    return (
                      <div key={date} className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-2 text-sm text-gray-500 font-medium">
                          <span>{formatDateStr(date)}</span>
                          <span>Total: {formatDuration(dayTotal)}</span>
                        </div>
                        
                        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                          {dayEntries.map((entry, index) => {
                            const project = projects.find(p => p.id === entry.projectId);
                            return (
                              <div key={entry.id} className={`flex items-center justify-between p-4 hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${index !== dayEntries.length - 1 ? 'border-b border-gray-100' : ''}`}>
                                <div className="flex items-center gap-4 flex-1">
                                  <span className={`text-gray-800 font-medium ${!entry.description ? 'text-gray-400 italic' : ''}`}>
                                    {entry.description || '(no description)'}
                                  </span>
                                  {project && (
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50">
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: project.color }}></span>
                                      <span className="text-xs text-gray-600 font-medium">{project.name}</span>
                                    </div>
                                  )}
                                </div>
                                
                                <div className="flex items-center gap-6">
                                  <div className="text-sm text-gray-500 font-medium w-32 text-right">
                                    {formatTime(entry.startTime)} - {formatTime(entry.endTime)}
                                  </div>
                                  <div className="text-lg font-mono font-medium text-gray-800 w-24 text-right">
                                    {formatDuration(entry.duration)}
                                  </div>
                                  <div className={`relative ${openDropdownId === entry.id ? 'z-10' : ''}`}>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenDropdownId(openDropdownId === entry.id ? null : entry.id);
                                      }}
                                      className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-200 transition-colors cursor-pointer"
                                    >
                                      <MoreVertical size={16} />
                                    </button>
                                    {openDropdownId === entry.id && (
                                      <div className="absolute right-0 mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteEntry(entry.id);
                                            setOpenDropdownId(null);
                                          }}
                                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                        >
                                          <Trash2 size={14} /> Delete
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}

        {currentView === 'projects' && (
          <div className="flex-1 overflow-y-auto p-6 pb-32 bg-gray-50">
            <div className="max-w-5xl mx-auto flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-800">Projects</h1>
                <button 
                  onClick={() => setIsAddingProject(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
                >
                  <Plus size={18} /> New Project
                </button>
              </div>

              {isAddingProject && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">New Project</h2>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Project name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6"
                      value={newProjectName}
                      onChange={e => setNewProjectName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newProjectName.trim()) {
                          const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4'];
                          handleAddProject(newProjectName.trim(), colors[Math.floor(Math.random() * colors.length)]);
                          setNewProjectName('');
                          setIsAddingProject(false);
                        }
                      }}
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => {
                          setIsAddingProject(false);
                          setNewProjectName('');
                        }}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (newProjectName.trim()) {
                            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4'];
                            handleAddProject(newProjectName.trim(), colors[Math.floor(Math.random() * colors.length)]);
                            setNewProjectName('');
                            setIsAddingProject(false);
                          }
                        }}
                        disabled={!newProjectName.trim()}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Create
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                {projects.map((project, index) => (
                  <div key={project.id} className={`flex items-center justify-between p-4 hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${index !== projects.length - 1 ? 'border-b border-gray-100' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }}></span>
                      <span className="font-medium text-gray-800">{project.name}</span>
                    </div>
                    <div className={`relative ${openDropdownId === project.id ? 'z-10' : ''}`}>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdownId(openDropdownId === project.id ? null : project.id);
                        }}
                        className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-200 transition-colors cursor-pointer"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {openDropdownId === project.id && (
                        <div className="absolute right-0 mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProject(project.id);
                              setOpenDropdownId(null);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {currentView === 'reports' && (
          <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
            <div className="max-w-5xl mx-auto flex flex-col gap-6">
              <h1 className="text-2xl font-bold text-gray-800">Reports</h1>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm flex flex-col gap-2">
                  <span className="text-sm text-gray-500 font-medium uppercase tracking-wider">Total Time</span>
                  <span className="text-3xl font-mono font-bold text-gray-800">
                    {formatDuration(entries.reduce((acc, e) => acc + e.duration, 0))}
                  </span>
                </div>
                <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm flex flex-col gap-2">
                  <span className="text-sm text-gray-500 font-medium uppercase tracking-wider">Total Entries</span>
                  <span className="text-3xl font-bold text-gray-800">{entries.length}</span>
                </div>
                <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm flex flex-col gap-2">
                  <span className="text-sm text-gray-500 font-medium uppercase tracking-wider">Active Projects</span>
                  <span className="text-3xl font-bold text-gray-800">
                    {new Set(entries.map(e => e.projectId).filter(Boolean)).size}
                  </span>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mt-4">
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-semibold text-gray-800">Time by Project</h2>
                </div>
                <div className="p-4 flex flex-col gap-4">
                  {projects.map(project => {
                    const projectEntries = entries.filter(e => e.projectId === project.id);
                    const projectTime = projectEntries.reduce((acc, e) => acc + e.duration, 0);
                    
                    if (projectTime === 0) return null;

                    const totalTime = entries.reduce((acc, e) => acc + e.duration, 0);
                    const percentage = totalTime > 0 ? (projectTime / totalTime) * 100 : 0;
                    const isExpanded = expandedReportProjects.includes(project.id);

                    return (
                      <div key={project.id} className="flex flex-col gap-1">
                        <div 
                          className="flex items-center justify-between text-sm cursor-pointer hover:bg-gray-100 p-1.5 -mx-1.5 rounded transition-colors"
                          onClick={() => toggleReportProject(project.id)}
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: project.color }}></span>
                            <span className="font-medium text-gray-700">{project.name}</span>
                          </div>
                          <span className="font-mono text-gray-600">{formatDuration(projectTime)}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
                          <div 
                            className="h-2 rounded-full" 
                            style={{ width: `${percentage}%`, backgroundColor: project.color }}
                          ></div>
                        </div>
                        {isExpanded && (
                          <div className="ml-6 mt-1 mb-3 flex flex-col gap-2 border-l-2 border-gray-100 pl-4 py-1">
                            {projectEntries.sort((a, b) => b.startTime - a.startTime).map(entry => (
                              <div key={entry.id} className="flex items-center justify-between text-sm">
                                <div className="flex flex-col">
                                  <span className="text-gray-800">{entry.description || <span className="text-gray-400 italic">No description</span>}</span>
                                  <span className="text-xs text-gray-500">{new Date(entry.startTime).toLocaleDateString()} {formatTime(entry.startTime)} - {formatTime(entry.endTime)}</span>
                                </div>
                                <span className="font-mono text-gray-600">{formatDuration(entry.duration)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(() => {
                    const noProjectEntries = entries.filter(e => !e.projectId);
                    const noProjectTime = noProjectEntries.reduce((acc, e) => acc + e.duration, 0);
                    
                    if (noProjectTime === 0) return null;
                    
                    const totalTime = entries.reduce((acc, e) => acc + e.duration, 0);
                    const percentage = totalTime > 0 ? (noProjectTime / totalTime) * 100 : 0;
                    const isExpanded = expandedReportProjects.includes('no-project');

                    return (
                      <div className="flex flex-col gap-1">
                        <div 
                          className="flex items-center justify-between text-sm cursor-pointer hover:bg-gray-100 p-1.5 -mx-1.5 rounded transition-colors"
                          onClick={() => toggleReportProject('no-project')}
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                            <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                            <span className="font-medium text-gray-700">No Project</span>
                          </div>
                          <span className="font-mono text-gray-600">{formatDuration(noProjectTime)}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
                          <div 
                            className="h-2 rounded-full bg-gray-400" 
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                        {isExpanded && (
                          <div className="ml-6 mt-1 mb-3 flex flex-col gap-2 border-l-2 border-gray-100 pl-4 py-1">
                            {noProjectEntries.sort((a, b) => b.startTime - a.startTime).map(entry => (
                              <div key={entry.id} className="flex items-center justify-between text-sm">
                                <div className="flex flex-col">
                                  <span className="text-gray-800">{entry.description || <span className="text-gray-400 italic">No description</span>}</span>
                                  <span className="text-xs text-gray-500">{new Date(entry.startTime).toLocaleDateString()} {formatTime(entry.startTime)} - {formatTime(entry.endTime)}</span>
                                </div>
                                <span className="font-mono text-gray-600">{formatDuration(entry.duration)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {entries.length === 0 && (
                    <div className="text-center text-gray-500 py-4 text-sm">
                      No data available yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
