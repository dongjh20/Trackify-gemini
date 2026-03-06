import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Minimize2, Maximize2, Clock, List, BarChart2, Settings, MoreVertical, Plus, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, query, where } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { db, auth, googleProvider } from './firebase';
import { Project, TimeEntry, ActiveTimer } from './types';
import { formatDuration, formatTime, formatDateStr, groupByDay } from './utils';
import { ProjectSelector } from './components/ProjectSelector';
import { TimerDisplay } from './components/TimerDisplay';

type View = 'tracker' | 'projects' | 'reports';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('tracker');
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  
  // Draft state for when timer is NOT running
  const [draftDescription, setDraftDescription] = useState('');
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  
  const [isCompactMode, setIsCompactMode] = useState(false);
  const [expandedReportProjects, setExpandedReportProjects] = useState<string[]>([]);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedChartProject, setSelectedChartProject] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setOpenDropdownId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firebase Realtime Listeners
  useEffect(() => {
    if (!user) return;

    const qProjects = query(collection(db, 'projects'), where('userId', '==', user.uid));
    const unsubscribeProjects = onSnapshot(qProjects, (snapshot) => {
      const projs: Project[] = [];
      snapshot.forEach(doc => projs.push({ id: doc.id, ...doc.data() } as Project));
      setProjects(projs);
    }, (error) => console.error("Projects error:", error));

    const qEntries = query(collection(db, 'entries'), where('userId', '==', user.uid));
    const unsubscribeEntries = onSnapshot(qEntries, (snapshot) => {
      const ents: TimeEntry[] = [];
      snapshot.forEach(doc => ents.push({ id: doc.id, ...doc.data() } as TimeEntry));
      // Sort entries by startTime descending
      ents.sort((a, b) => b.startTime - a.startTime);
      setEntries(ents);
    }, (error) => console.error("Entries error:", error));

    const qTimer = query(collection(db, 'activeTimers'), where('userId', '==', user.uid));
    const unsubscribeTimer = onSnapshot(qTimer, (snapshot) => {
      if (!snapshot.empty) {
        const timerData = snapshot.docs[0].data();
        if (timerData.isActive) {
          setActiveTimer(timerData as ActiveTimer);
        } else {
          setActiveTimer(null);
        }
      } else {
        setActiveTimer(null);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("Timer error:", error);
      setIsLoading(false);
    });

    return () => {
      unsubscribeProjects();
      unsubscribeEntries();
      unsubscribeTimer();
    };
  }, [user]);

  const toggleReportProject = (id: string) => {
    setExpandedReportProjects(prev =>
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const handleAddProject = async (name: string, color: string) => {
    if (!user) return;
    const newProjectRef = doc(collection(db, 'projects'));
    const newProject: Project = {
      id: newProjectRef.id,
      name,
      color
    };
    await setDoc(newProjectRef, { ...newProject, userId: user.uid });
    
    // Automatically select the new project if we are in the tracker
    if (activeTimer) {
      updateActiveTimer({ projectId: newProject.id });
    } else {
      setDraftProjectId(newProject.id);
    }
  };

  const handleDeleteProject = async (id: string) => {
    await deleteDoc(doc(db, 'projects', id));
    // Update all entries that used this project to have no project
    entries.forEach(async (e) => {
      if (e.projectId === id) {
        await updateDoc(doc(db, 'entries', e.id), { projectId: null });
      }
    });
    if (draftProjectId === id) setDraftProjectId(null);
    if (activeTimer?.projectId === id) updateActiveTimer({ projectId: null });
  };

  const handleDeleteEntry = async (id: string) => {
    await deleteDoc(doc(db, 'entries', id));
  };

  const handleStart = async () => {
    if (activeTimer || !user) return;
    const newTimer = {
      description: draftDescription,
      projectId: draftProjectId,
      startTime: Date.now(),
      totalPausedTime: 0,
      lastPauseTime: null,
      isPaused: false,
      isActive: true,
      userId: user.uid
    };
    await setDoc(doc(db, 'activeTimers', user.uid), newTimer);
    setDraftDescription('');
    setDraftProjectId(null);
  };

  const handlePause = async () => {
    if (activeTimer && !activeTimer.isPaused && user) {
      await updateDoc(doc(db, 'activeTimers', user.uid), {
        isPaused: true,
        lastPauseTime: Date.now(),
      });
    }
  };

  const handleResume = async () => {
    if (activeTimer && activeTimer.isPaused && activeTimer.lastPauseTime && user) {
      const pausedDuration = Date.now() - activeTimer.lastPauseTime;
      await updateDoc(doc(db, 'activeTimers', user.uid), {
        isPaused: false,
        totalPausedTime: activeTimer.totalPausedTime + pausedDuration,
        lastPauseTime: null,
      });
    }
  };

  const handleStop = async () => {
    if (activeTimer && user) {
      try {
        const endTime = Date.now();
        let finalDuration = endTime - activeTimer.startTime - activeTimer.totalPausedTime;
        if (activeTimer.isPaused && activeTimer.lastPauseTime) {
          finalDuration -= (endTime - activeTimer.lastPauseTime);
        }
        
        const newEntryRef = doc(collection(db, 'entries'));
        const newEntry: TimeEntry = {
          id: newEntryRef.id,
          description: activeTimer.description,
          projectId: activeTimer.projectId,
          startTime: activeTimer.startTime,
          endTime: activeTimer.isPaused && activeTimer.lastPauseTime ? activeTimer.lastPauseTime : endTime,
          duration: finalDuration,
        };
        
        await setDoc(newEntryRef, { ...newEntry, userId: user.uid });
        await deleteDoc(doc(db, 'activeTimers', user.uid));
        setDraftProjectId(activeTimer.projectId); // Remember the project for the next entry
      } catch (error) {
        console.error("Error stopping timer:", error);
        alert("Failed to stop timer. Please try again.");
      }
    }
  };

  const updateActiveTimer = async (updates: Partial<ActiveTimer>) => {
    if (activeTimer && user) {
      await updateDoc(doc(db, 'activeTimers', user.uid), updates);
    }
  };

  const groupedEntries = groupByDay(entries);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-sm w-full border border-gray-100">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Clock className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Trackify</h1>
          <p className="text-gray-500 mb-8">Sign in to sync your time across all your devices securely.</p>
          <button
            onClick={async () => {
              try {
                await signInWithPopup(auth, googleProvider);
              } catch (error: any) {
                console.error("Auth Error:", error);
                if (error.code === 'auth/configuration-not-found') {
                  alert("Authentication failed: Google Sign-In is not enabled in your Firebase Console. Please go to Authentication -> Sign-in method and enable Google.");
                } else if (error.code === 'auth/unauthorized-domain') {
                  const currentDomain = window.location.hostname;
                  alert(`Authentication failed: The domain "${currentDomain}" is not authorized for OAuth operations.\n\nTo fix this:\n1. Go to Firebase Console -> Authentication -> Settings -> Authorized domains\n2. Click "Add domain"\n3. Paste exactly this: ${currentDomain}\n4. Click "Add"\n5. Refresh this page and try again.`);
                } else {
                  alert(`Authentication failed: ${error.message}`);
                }
              }
            }}
            className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-3 shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

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
    <div className="h-screen flex flex-col md:flex-row bg-gray-50 text-gray-800 font-sans overflow-hidden">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col flex-shrink-0">
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
        <div className="p-4 border-t border-gray-200 flex flex-col gap-2">
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-gray-500 font-medium">
            <img src={user?.photoURL || ''} alt="" className="w-6 h-6 rounded-full bg-gray-200" />
            <span className="truncate">{user?.displayName || 'User'}</span>
          </div>
          <button onClick={() => signOut(auth)} className="flex items-center gap-3 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors w-full text-left">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {currentView === 'tracker' && (
          <>
            {/* Topbar / Timer Bar */}
            <header className="bg-white border-b border-gray-200 shadow-sm z-10 flex-shrink-0">
              <div className="max-w-5xl mx-auto px-4 py-3 md:h-16 flex flex-col md:flex-row items-center justify-between gap-3 md:gap-4">
                <input 
                  type="text"
                  placeholder="What are you working on?"
                  className="w-full md:flex-1 text-base border-none focus:ring-0 p-0 placeholder-gray-400 bg-transparent outline-none"
                  value={activeTimer ? activeTimer.description : draftDescription}
                  onChange={(e) => activeTimer ? updateActiveTimer({ description: e.target.value }) : setDraftDescription(e.target.value)}
                />
                
                <div className="flex items-center justify-between w-full md:w-auto gap-2 md:gap-6">
                  <ProjectSelector 
                    projects={projects}
                    selectedProjectId={activeTimer ? activeTimer.projectId : draftProjectId}
                    onChange={(id) => activeTimer ? updateActiveTimer({ projectId: id }) : setDraftProjectId(id)}
                    onAddProject={handleAddProject}
                  />
                  
                  <div className="hidden md:block h-6 w-px bg-gray-200"></div>
                  
                  <div className="flex items-center gap-4 md:gap-6">
                    <TimerDisplay activeTimer={activeTimer} className={`text-xl font-mono md:w-24 text-right ${activeTimer?.isPaused ? 'text-gray-400' : 'text-gray-800'}`} />
                    
                    <div className="flex items-center gap-2">
                      {!activeTimer ? (
                        <button onClick={handleStart} className="w-20 md:w-24 h-10 rounded bg-blue-500 hover:bg-blue-600 text-white font-medium flex items-center justify-center transition-colors cursor-pointer">
                          START
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          {activeTimer.isPaused ? (
                            <button onClick={handleResume} className="w-10 md:w-12 h-10 rounded bg-blue-100 hover:bg-blue-200 text-blue-600 flex items-center justify-center transition-colors cursor-pointer">
                              <Play size={18} className="ml-1" />
                            </button>
                          ) : (
                            <button onClick={handlePause} className="w-10 md:w-12 h-10 rounded bg-amber-100 hover:bg-amber-200 text-amber-600 flex items-center justify-center transition-colors cursor-pointer">
                              <Pause size={18} />
                            </button>
                          )}
                          <button onClick={handleStop} className="w-20 md:w-24 h-10 rounded bg-red-500 hover:bg-red-600 text-white font-medium flex items-center justify-center transition-colors cursor-pointer">
                            STOP
                          </button>
                        </div>
                      )}
                    </div>
                    
                    <button 
                      onClick={() => setIsCompactMode(true)}
                      className="hidden md:block p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors cursor-pointer"
                      title="Mini Tracker"
                    >
                      <Minimize2 size={18} />
                    </button>
                  </div>
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
                              <div key={entry.id} className={`flex flex-col md:flex-row md:items-center justify-between p-4 hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${index !== dayEntries.length - 1 ? 'border-b border-gray-100' : ''}`}>
                                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 flex-1 mb-3 md:mb-0">
                                  <span className={`text-gray-800 font-medium ${!entry.description ? 'text-gray-400 italic' : ''}`}>
                                    {entry.description || '(no description)'}
                                  </span>
                                  {project && (
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 self-start md:self-auto">
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: project.color }}></span>
                                      <span className="text-xs text-gray-600 font-medium">{project.name}</span>
                                    </div>
                                  )}
                                </div>
                                
                                <div className="flex items-center justify-between md:justify-end gap-4 md:gap-6 w-full md:w-auto">
                                  <div className="text-sm text-gray-500 font-medium md:w-32 md:text-right">
                                    {formatTime(entry.startTime)} - {formatTime(entry.endTime)}
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <div className="text-lg font-mono font-medium text-gray-800 md:w-24 text-right">
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
                  className="flex items-center gap-2 px-3 py-2 md:px-4 md:py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors text-sm md:text-base"
                >
                  <Plus size={18} /> <span className="hidden sm:inline">New Project</span><span className="sm:hidden">New</span>
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
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
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

              {/* Chart Section */}
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mt-4">
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-semibold text-gray-800">Time Distribution</h2>
                </div>
                <div className="p-4 flex flex-col md:flex-row gap-6">
                  <div className="w-full md:w-1/2 h-80">
                    {(() => {
                      const totalDuration = entries.reduce((acc, e) => acc + e.duration, 0);
                      const chartData = projects.map(p => {
                        const duration = entries.filter(e => e.projectId === p.id).reduce((acc, e) => acc + e.duration, 0);
                        return { name: p.name, value: duration, color: p.color, id: p.id };
                      }).filter(d => d.value > 0);

                      const noProjectDuration = entries.filter(e => !e.projectId).reduce((acc, e) => acc + e.duration, 0);
                      if (noProjectDuration > 0) {
                        chartData.push({ name: 'No Project', value: noProjectDuration, color: '#9ca3af', id: 'no-project' });
                      }

                      const CustomTooltip = ({ active, payload }: any) => {
                        if (active && payload && payload.length) {
                          const percent = totalDuration > 0 ? ((payload[0].value / totalDuration) * 100).toFixed(1) : 0;
                          return (
                            <div className="bg-white p-2 border border-gray-200 shadow-sm rounded text-sm">
                              <p className="font-medium text-gray-800">{payload[0].name}</p>
                              <p className="text-gray-600 font-mono">{formatDuration(payload[0].value)} ({percent}%)</p>
                            </div>
                          );
                        }
                        return null;
                      };

                      const renderLegend = (props: any) => {
                        const { payload } = props;
                        return (
                          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm mt-4">
                            {payload.map((entry: any, index: number) => {
                              const percentage = totalDuration > 0 ? ((entry.payload.value / totalDuration) * 100).toFixed(1) : 0;
                              return (
                                <li key={`item-${index}`} className="flex items-center gap-1.5 cursor-pointer" onClick={() => setSelectedChartProject(selectedChartProject === entry.payload.id ? null : entry.payload.id)}>
                                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }}></span>
                                  <span className={`text-gray-700 ${selectedChartProject === entry.payload.id ? 'font-bold' : ''}`}>{entry.value}</span>
                                  <span className="text-gray-500 font-mono text-xs ml-1">{formatDuration(entry.payload.value)} ({percentage}%)</span>
                                </li>
                              );
                            })}
                          </ul>
                        );
                      };

                      const RADIAN = Math.PI / 180;
                      const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
                        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                        const x = cx + radius * Math.cos(-midAngle * RADIAN);
                        const y = cy + radius * Math.sin(-midAngle * RADIAN);

                        return percent > 0.05 ? (
                          <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-xs font-medium pointer-events-none">
                            {`${(percent * 100).toFixed(0)}%`}
                          </text>
                        ) : null;
                      };

                      return chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={chartData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={2}
                              dataKey="value"
                              onClick={(data) => setSelectedChartProject(selectedChartProject === data.id ? null : data.id)}
                              className="cursor-pointer outline-none"
                              labelLine={false}
                              label={renderCustomizedLabel}
                            >
                              {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} stroke={selectedChartProject === entry.id ? '#000' : 'none'} strokeWidth={selectedChartProject === entry.id ? 2 : 0} />
                              ))}
                            </Pie>
                            <RechartsTooltip content={<CustomTooltip />} />
                            <Legend content={renderLegend} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-gray-400 text-sm">No data to display</div>
                      );
                    })()}
                  </div>
                  
                  <div className="w-full md:w-1/2 flex flex-col h-80">
                    <h3 className="font-medium text-gray-700 mb-3 border-b border-gray-100 pb-2 flex-shrink-0">
                      {selectedChartProject ? (
                        selectedChartProject === 'no-project' ? 'No Project Details' : projects.find(p => p.id === selectedChartProject)?.name + ' Details'
                      ) : (
                        'Click a slice to view details'
                      )}
                    </h3>
                    
                    {selectedChartProject ? (
                      <div className="flex flex-col h-full overflow-hidden">
                        {(() => {
                          const projectEntries = selectedChartProject === 'no-project' 
                            ? entries.filter(e => !e.projectId) 
                            : entries.filter(e => e.projectId === selectedChartProject);
                          
                          const projectTotalDuration = projectEntries.reduce((acc, e) => acc + e.duration, 0);
                          
                          const entriesByDesc = projectEntries.reduce((acc, e) => {
                            const desc = e.description || 'No description';
                            if (!acc[desc]) acc[desc] = 0;
                            acc[desc] += e.duration;
                            return acc;
                          }, {} as Record<string, number>);

                          const drillDownData = Object.entries(entriesByDesc).map(([name, value], index) => {
                            const colors = ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#f472b6', '#2dd4bf', '#94a3b8'];
                            return { name, value: Number(value), color: colors[index % colors.length] };
                          }).sort((a, b) => b.value - a.value);

                          const DrillDownTooltip = ({ active, payload }: any) => {
                            if (active && payload && payload.length) {
                              const percent = projectTotalDuration > 0 ? ((payload[0].value / projectTotalDuration) * 100).toFixed(1) : 0;
                              return (
                                <div className="bg-white p-2 border border-gray-200 shadow-sm rounded text-sm z-50">
                                  <p className="font-medium text-gray-800">{payload[0].name}</p>
                                  <p className="text-gray-600 font-mono">{formatDuration(payload[0].value)} ({percent}%)</p>
                                </div>
                              );
                            }
                            return null;
                          };

                          const renderDrillDownLegend = (props: any) => {
                            const { payload } = props;
                            return (
                              <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs mt-2 overflow-y-auto max-h-20">
                                {payload.map((entry: any, index: number) => {
                                  const percentage = projectTotalDuration > 0 ? ((entry.payload.value / projectTotalDuration) * 100).toFixed(1) : 0;
                                  return (
                                    <li key={`item-${index}`} className="flex items-center gap-1 cursor-pointer">
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                                      <span className="text-gray-700 truncate max-w-[100px]" title={entry.value}>{entry.value}</span>
                                      <span className="text-gray-500 font-mono text-[10px] ml-0.5">{formatDuration(entry.payload.value)} ({percentage}%)</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            );
                          };

                          const RADIAN = Math.PI / 180;
                          const renderDrillDownLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
                            const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                            const x = cx + radius * Math.cos(-midAngle * RADIAN);
                            const y = cy + radius * Math.sin(-midAngle * RADIAN);

                            return percent > 0.05 ? (
                              <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-[10px] font-medium pointer-events-none">
                                {`${(percent * 100).toFixed(0)}%`}
                              </text>
                            ) : null;
                          };

                          return (
                            <>
                              <div className="h-56 flex-shrink-0 mb-2">
                                <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                    <Pie
                                      data={drillDownData}
                                      cx="50%"
                                      cy="45%"
                                      innerRadius={30}
                                      outerRadius={60}
                                      paddingAngle={2}
                                      dataKey="value"
                                      className="outline-none"
                                      labelLine={false}
                                      label={renderDrillDownLabel}
                                    >
                                      {drillDownData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                      ))}
                                    </Pie>
                                    <RechartsTooltip content={<DrillDownTooltip />} />
                                    <Legend content={renderDrillDownLegend} verticalAlign="bottom" />
                                  </PieChart>
                                </ResponsiveContainer>
                              </div>
                              <div className="overflow-y-auto flex-1 pr-2">
                                <div className="flex flex-col gap-2">
                                  {projectEntries.sort((a, b) => b.startTime - a.startTime).map(entry => (
                                    <div key={entry.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded border border-gray-100">
                                      <div className="flex flex-col">
                                        <span className="text-gray-800 font-medium">{entry.description || <span className="text-gray-400 italic">No description</span>}</span>
                                        <span className="text-xs text-gray-500">{new Date(entry.startTime).toLocaleDateString()} {formatTime(entry.startTime)}</span>
                                      </div>
                                      <span className="font-mono text-gray-600">{formatDuration(entry.duration)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 flex items-center justify-center h-full">
                        Select a project from the chart to see its detailed breakdown.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bar Chart Section */}
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mt-4">
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-semibold text-gray-800">Last 7 Days</h2>
                </div>
                <div className="p-4 h-72">
                  {(() => {
                    const last7Days = Array.from({ length: 7 }).map((_, i) => {
                      const d = new Date();
                      d.setDate(d.getDate() - 6 + i);
                      return d;
                    });

                    const barChartData = last7Days.map(date => {
                      const dayEntries = entries.filter(e => {
                        const d = new Date(e.startTime);
                        return d.getFullYear() === date.getFullYear() && 
                               d.getMonth() === date.getMonth() && 
                               d.getDate() === date.getDate();
                      });
                      const duration = dayEntries.reduce((acc, e) => acc + e.duration, 0);
                      return {
                        name: date.toLocaleDateString('en-US', { weekday: 'short' }),
                        fullDate: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                        durationMs: duration,
                        durationHours: Number((duration / (1000 * 60 * 60)).toFixed(2))
                      };
                    });

                    const CustomBarTooltip = ({ active, payload }: any) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-white p-2 border border-gray-200 shadow-sm rounded text-sm">
                            <p className="font-medium text-gray-800">{payload[0].payload.fullDate}</p>
                            <p className="text-gray-600 font-mono">{formatDuration(payload[0].payload.durationMs)}</p>
                          </div>
                        );
                      }
                      return null;
                    };

                    return entries.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={barChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                          <RechartsTooltip content={<CustomBarTooltip />} cursor={{ fill: '#f3f4f6' }} />
                          <Bar dataKey="durationHours" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={50} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-400 text-sm">No data to display</div>
                    );
                  })()}
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

      {/* Bottom Navigation (Mobile) */}
      <nav className="md:hidden bg-white border-t border-gray-200 flex items-center justify-around h-16 flex-shrink-0 z-50">
        <button 
          onClick={() => setCurrentView('tracker')} 
          className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'tracker' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <Clock size={20} />
          <span className="text-[10px] font-medium mt-1">Tracker</span>
        </button>
        <button 
          onClick={() => setCurrentView('projects')} 
          className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'projects' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <List size={20} />
          <span className="text-[10px] font-medium mt-1">Projects</span>
        </button>
        <button 
          onClick={() => setCurrentView('reports')} 
          className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'reports' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <BarChart2 size={20} />
          <span className="text-[10px] font-medium mt-1">Reports</span>
        </button>
      </nav>
    </div>
  );
}
