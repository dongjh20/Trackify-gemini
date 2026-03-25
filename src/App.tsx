import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Play, Pause, Square, Minimize2, Maximize2, Clock, List, BarChart2, Settings, MoreVertical, Plus, ChevronDown, ChevronRight, Trash2, LogOut, Mail, Lock, RotateCcw, Trash, Upload, Download, Image as ImageIcon, Folder } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, query, where, getDocs, orderBy, limit, deleteField } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, deleteUser, sendEmailVerification } from 'firebase/auth';
import { db, auth, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { Project, TimeEntry, ActiveTimer, DeletedEntry, ProjectGroup } from './types';
import { formatDuration, formatTime, formatDateStr, groupByDay } from './utils';
import { ProjectSelector } from './components/ProjectSelector';
import { TimerDisplay } from './components/TimerDisplay';
import { EditEntryModal } from './components/EditEntryModal';

const updateFavicon = (url: string) => {
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url;
};

type View = 'tracker' | 'projects' | 'reports' | 'settings' | 'recycle-bin';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('tracker');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [deletedEntries, setDeletedEntries] = useState<DeletedEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [appIcon, setAppIcon] = useState<string | null>(null);
  
  // Draft state for when timer is NOT running
  const [draftDescription, setDraftDescription] = useState('');
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  
  const [isCompactMode, setIsCompactMode] = useState(false);
  const [autoStopOnLock, setAutoStopOnLock] = useState(() => {
    return localStorage.getItem('autoStopOnLock') === 'true';
  });
  const [expandedReportProjects, setExpandedReportProjects] = useState<string[]>([]);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addingToGroupId, setAddingToGroupId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingFolder, setEditingFolder] = useState<ProjectGroup | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [selectedChartProject, setSelectedChartProject] = useState<string | null>(null);
  const [selectedBarProject, setSelectedBarProject] = useState<string | null>(null);

  // Email/Password Auth State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);
  const [reportTimeRange, setReportTimeRange] = useState<'day' | 'week' | 'month' | 'year'>('week');
  const [reportView, setReportView] = useState<'stats' | 'timeline'>('stats');

  const filteredReportEntriesWithSleep = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    let startTimeLimit = 0;
    switch (reportTimeRange) {
      case 'day':
        startTimeLimit = startOfToday;
        break;
      case 'week':
        startTimeLimit = startOfToday - 6 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
        startTimeLimit = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        break;
      case 'year':
        startTimeLimit = new Date(now.getFullYear(), 0, 1).getTime();
        break;
    }
    
    return entries.filter(e => e.startTime >= startTimeLimit);
  }, [entries, reportTimeRange]);

  const filteredReportEntries = useMemo(() => {
    return filteredReportEntriesWithSleep.filter(e => {
      const project = projects.find(p => p.id === e.projectId);
      return project?.name.toLowerCase() !== 'sleep';
    });
  }, [filteredReportEntriesWithSleep, projects]);

  // Delete Account Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Hover state for spacebar shortcuts
  const [hoveredButton, setHoveredButton] = useState<'pause' | 'resume' | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (hoveredButton === 'pause') {
          e.preventDefault();
          handlePause();
        } else if (hoveredButton === 'resume') {
          e.preventDefault();
          handleResume();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredButton, activeTimer]);

  useEffect(() => {
    const handleClickOutside = () => setOpenDropdownId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // High-DPI Auto-Adaptation
  useEffect(() => {
    // Force a resize event shortly after mount to handle high-DPI screen scaling issues
    // This simulates the window being moved or resized, forcing the browser to recalculate layout
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
    
    // Listen for DPI changes (e.g., when moving between screens)
    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handleDpiChange = () => {
      window.dispatchEvent(new Event('resize'));
    };
    
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleDpiChange);
    } else {
      mediaQuery.addListener(handleDpiChange);
    }

    return () => {
      clearTimeout(timer);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleDpiChange);
      } else {
        mediaQuery.removeListener(handleDpiChange);
      }
    };
  }, []);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsEmailVerified(currentUser?.emailVerified || false);
      if (currentUser) {
        const savedAvatar = localStorage.getItem(`avatar_${currentUser.uid}`);
        if (savedAvatar) setUserAvatar(savedAvatar);
        
        const savedAppIcon = localStorage.getItem(`appIcon_${currentUser.uid}`);
        if (savedAppIcon) {
          setAppIcon(savedAppIcon);
          updateFavicon(savedAppIcon);
        }
      } else {
        setUserAvatar(null);
        setAppIcon(null);
        updateFavicon('/icon.svg');
      }
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
      projs.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return a.name.localeCompare(b.name);
      });
      setProjects(projs);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'projects'));

    const qGroups = query(collection(db, 'projectGroups'), where('userId', '==', user.uid));
    const unsubscribeGroups = onSnapshot(qGroups, (snapshot) => {
      const groups: ProjectGroup[] = [];
      snapshot.forEach(doc => groups.push({ id: doc.id, ...doc.data() } as ProjectGroup));
      groups.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return a.name.localeCompare(b.name);
      });
      setProjectGroups(groups);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'projectGroups'));

    const qEntries = query(collection(db, 'entries'), where('userId', '==', user.uid));
    const unsubscribeEntries = onSnapshot(qEntries, (snapshot) => {
      const ents: TimeEntry[] = [];
      const deleted: DeletedEntry[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.deletedAt) {
          deleted.push({ id: doc.id, ...data } as DeletedEntry);
        } else {
          ents.push({ id: doc.id, ...data } as TimeEntry);
        }
      });
      // Sort entries by startTime descending
      ents.sort((a, b) => b.startTime - a.startTime);
      deleted.sort((a, b) => b.deletedAt - a.deletedAt);
      setEntries(ents);
      setDeletedEntries(deleted);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'entries'));

    const timerRef = doc(db, 'activeTimers', user.uid);
    const unsubscribeTimer = onSnapshot(timerRef, (docSnap) => {
      if (docSnap.exists()) {
        const timerData = docSnap.data() as ActiveTimer;
        if (timerData.isActive) {
          setActiveTimer(timerData);
        } else {
          setActiveTimer(null);
        }
      } else {
        setActiveTimer(null);
      }
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'activeTimers');
      setIsLoading(false);
    });

    return () => {
      unsubscribeProjects();
      unsubscribeGroups();
      unsubscribeEntries();
      unsubscribeTimer();
    };
  }, [user]);

  // Cleanup old deleted entries (older than 2 days)
  useEffect(() => {
    if (!user) return;
    
    const cleanup = async () => {
      try {
        const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
        const q = query(
          collection(db, 'entries'), 
          where('userId', '==', user.uid)
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) return;
        
        const toDelete = snapshot.docs.filter(doc => {
          const data = doc.data();
          return data.deletedAt && data.deletedAt < twoDaysAgo;
        });
        
        if (toDelete.length === 0) return;
        
        const deletePromises = toDelete.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        console.log(`Cleaned up ${deletePromises.length} expired recycle bin entries.`);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'entries');
      }
    };
    
    cleanup();
  }, [user]);

  // Migrate old idle entries to Idle project
  useEffect(() => {
    if (!user || projects.length === 0 || entries.length === 0) return;
    
    const migrateIdleEntries = async () => {
      const idleEntries = entries.filter(e => 
        !e.projectId && 
        (e.description === 'Idle (Paused)' || e.description === 'Idle (Stopped)')
      );
      
      if (idleEntries.length > 0) {
        try {
          const idleProjectId = await getOrCreateIdleProject();
          if (idleProjectId) {
            const updates = idleEntries.map(e => 
              updateDoc(doc(db, 'entries', e.id), { projectId: idleProjectId })
            );
            await Promise.all(updates);
            console.log(`Migrated ${idleEntries.length} idle entries to Idle project.`);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, 'entries');
        }
      }
    };
    
    migrateIdleEntries();
  }, [user, entries, projects]);

  const toggleReportProject = (id: string) => {
    setExpandedReportProjects(prev =>
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const handleAddFolder = async (name: string) => {
    if (!user) return;
    const newFolderRef = doc(collection(db, 'projectGroups'));
    const maxOrder = projectGroups.length > 0 ? Math.max(...projectGroups.map(g => g.order || 0)) : 0;
    const newFolder: ProjectGroup = {
      id: newFolderRef.id,
      name,
      userId: user.uid,
      order: maxOrder + 1,
      isExpanded: true
    };
    try {
      await setDoc(newFolderRef, newFolder);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projectGroups');
    }
  };

  const handleUpdateFolder = async (id: string, updates: Partial<ProjectGroup>) => {
    try {
      await updateDoc(doc(db, 'projectGroups', id), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projectGroups');
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this folder? Projects inside will be moved to the root level.")) return;
    try {
      // Move projects to root
      const folderProjects = projects.filter(p => p.groupId === id);
      const movePromises = folderProjects.map(p => 
        updateDoc(doc(db, 'projects', p.id), { groupId: null })
      );
      await Promise.all(movePromises);
      
      // Delete folder
      await deleteDoc(doc(db, 'projectGroups', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'projectGroups');
    }
  };

  const handleUpdateProject = async (id: string, updates: Partial<Project>) => {
    try {
      await updateDoc(doc(db, 'projects', id), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projects');
    }
  };

  const handleMoveProject = async (projectId: string, targetGroupId: string | null) => {
    try {
      await updateDoc(doc(db, 'projects', projectId), { groupId: targetGroupId });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projects');
    }
  };

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: prev[folderId] === undefined ? false : !prev[folderId]
    }));
  };

  const handleAddProject = async (name: string, color: string, groupId?: string) => {
    if (!user) return;
    const newProjectRef = doc(collection(db, 'projects'));
    const maxOrder = projects.length > 0 ? Math.max(...projects.map(p => p.order || 0)) : 0;
    const newProject: Project = {
      id: newProjectRef.id,
      name,
      color,
      order: maxOrder + 1,
      ...(groupId ? { groupId } : {})
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
    try {
      // Move entries to recycle bin first
      const projectEntries = entries.filter(e => e.projectId === id);
      const now = Date.now();
      
      const recyclePromises = projectEntries.map(e => {
        return updateDoc(doc(db, 'entries', e.id), { deletedAt: now });
      });
      await Promise.all(recyclePromises);

      // Finally delete the project
      await deleteDoc(doc(db, 'projects', id));
      
      if (draftProjectId === id) setDraftProjectId(null);
      if (activeTimer?.projectId === id) updateActiveTimer({ projectId: null });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'projects');
    }
  };

  const handleRenameProject = async (id: string, currentName: string) => {
    const newName = window.prompt("Enter new project name:", currentName);
    if (newName && newName.trim() !== "" && newName.trim() !== currentName) {
      try {
        await updateDoc(doc(db, 'projects', id), { name: newName.trim() });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'projects');
      }
    }
  };

  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.stopPropagation();
    setDraggedProjectId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFolderDragStart = (e: React.DragEvent, id: string) => {
    e.stopPropagation();
    setDraggedFolderId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetId: string, isFolder: boolean = false) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedFolderId) {
      if (isFolder && draggedFolderId !== targetId) {
        await handleReorderFolder(draggedFolderId, targetId);
      }
      setDraggedFolderId(null);
      return;
    }

    if (!draggedProjectId) return;
    
    if (isFolder) {
      if (draggedProjectId !== targetId) {
        await handleMoveProject(draggedProjectId, targetId);
      }
    } else {
      if (draggedProjectId === targetId) return;
      const targetProject = projects.find(p => p.id === targetId);
      if (targetProject) {
        // Move to the same folder as the target project
        await updateDoc(doc(db, 'projects', draggedProjectId), { groupId: targetProject.groupId || null });
        await handleReorderProject(draggedProjectId, targetId);
      }
    }
    setDraggedProjectId(null);
  };

  const handleDropToRoot = async (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedFolderId) {
      setDraggedFolderId(null);
      return;
    }
    if (!draggedProjectId) return;
    await handleMoveProject(draggedProjectId, null);
    setDraggedProjectId(null);
  };

  const handleReorderFolder = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    const newGroups = [...projectGroups];
    const draggedIndex = newGroups.findIndex(g => g.id === draggedId);
    const targetIndex = newGroups.findIndex(g => g.id === targetId);

    const [draggedGroup] = newGroups.splice(draggedIndex, 1);
    newGroups.splice(targetIndex, 0, draggedGroup);

    // Update orders optimistically or just send to DB
    const updates = newGroups.map((g, index) => {
      return updateDoc(doc(db, 'projectGroups', g.id), { order: index });
    });

    try {
      await Promise.all(updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projectGroups');
    }
  };

  const handleReorderProject = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    const newProjects = [...projects];
    const draggedIndex = newProjects.findIndex(p => p.id === draggedId);
    const targetIndex = newProjects.findIndex(p => p.id === targetId);

    const [draggedProject] = newProjects.splice(draggedIndex, 1);
    newProjects.splice(targetIndex, 0, draggedProject);

    // Update orders optimistically or just send to DB
    const updates = newProjects.map((p, index) => {
      return updateDoc(doc(db, 'projects', p.id), { order: index });
    });

    try {
      await Promise.all(updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projects');
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setUserAvatar(base64);
      localStorage.setItem(`avatar_${user.uid}`, base64);
    };
    reader.readAsDataURL(file);
  };

  const handleAppIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setAppIcon(base64);
      localStorage.setItem(`appIcon_${user.uid}`, base64);
      updateFavicon(base64);
      alert("App icon updated! Note: For installed PWAs, you may need to reinstall the app to see the taskbar icon change.");
    };
    reader.readAsDataURL(file);
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(entries, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time-tracker-backup-${formatDateStr(new Date().toISOString().split('T')[0])}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedEntries = JSON.parse(event.target?.result as string);
        if (!Array.isArray(importedEntries)) throw new Error("Invalid format");
        let importCount = 0;
        for (const entry of importedEntries) {
          if (entry.id && entry.startTime && entry.duration) {
            await setDoc(doc(db, 'entries', entry.id), {
              ...entry,
              userId: user.uid
            });
            importCount++;
          }
        }
        alert(`Successfully imported ${importCount} entries!`);
      } catch (err) {
        alert("Failed to import. Please ensure it's a valid JSON backup file.");
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be selected again
    e.target.value = '';
  };

  const handleEditEntrySave = async (id: string, updates: Partial<TimeEntry>) => {
    try {
      if (id === 'new') {
        const newEntryRef = doc(collection(db, 'entries'));
        await setDoc(newEntryRef, {
          id: newEntryRef.id,
          userId: user?.uid,
          ...updates
        });
      } else {
        await updateDoc(doc(db, 'entries', id), updates);
      }
      setEditingEntry(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'entries');
    }
  };

  const handleContinueEntry = async (entry: TimeEntry) => {
    if (activeTimer || !user) return;
    
    try {
      // 1. Delete the entry
      await deleteDoc(doc(db, 'entries', entry.id));
      
      // 2. Create an active timer with its start time
      const newTimer: ActiveTimer = {
        description: entry.description,
        projectId: entry.projectId,
        startTime: entry.startTime,
        currentSegmentStartTime: entry.startTime,
        isPaused: false,
        totalPausedTime: 0,
        lastPauseTime: null,
        isActive: true,
        userId: user.uid
      };
      await setDoc(doc(db, 'activeTimers', user.uid), newTimer);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'activeTimers');
    }
  };

  const handleDeleteEntry = async (id: string) => {
    const entry = entries.find(e => e.id === id);
    if (!entry || !user) return;

    try {
      await updateDoc(doc(db, 'entries', id), { deletedAt: Date.now() });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'entries');
    }
  };

  const handleRestoreEntry = async (id: string) => {
    const deletedEntry = deletedEntries.find(e => e.id === id);
    if (!deletedEntry || !user) return;

    try {
      await updateDoc(doc(db, 'entries', id), { deletedAt: deleteField() });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'entries');
    }
  };

  const handlePermanentDeleteEntry = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'entries', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'entries');
    }
  };

  const getOrCreateIdleProject = async () => {
    if (!user) return null;
    let idleProj = projects.find(p => p.name.toLowerCase() === 'idle');
    if (!idleProj) {
      const newRef = doc(collection(db, 'projects'));
      idleProj = { id: newRef.id, name: 'Idle', color: '#9ca3af', order: 999 };
      await setDoc(newRef, { ...idleProj, userId: user.uid });
    }
    return idleProj.id;
  };

  const handleStart = async () => {
    if (activeTimer || !user) return;
    const now = Date.now();

    // Record Sleep or Idle (Stopped) if there's a gap since the last recorded entry
    if (entries.length > 0) {
      const latestEndTime = Math.max(...entries.map(e => e.endTime));
      if (latestEndTime > 0 && latestEndTime < now) {
        const gapDuration = now - latestEndTime;
        
        // Define night window for the current day (12 AM to 8 AM)
        const nightStart = new Date(now);
        nightStart.setHours(0, 0, 0, 0);
        const nightEnd = new Date(now);
        nightEnd.setHours(8, 0, 0, 0);

        // Check if gap is > 6 hours and crosses the night window
        const isNightSleep = gapDuration >= 6 * 3600 * 1000 && 
                             latestEndTime < nightEnd.getTime() && 
                             now > nightStart.getTime();

        if (isNightSleep) {
          const sleepProjectId = projects.find(p => p.name.toLowerCase() === 'sleep')?.id;
          if (sleepProjectId) {
            const sleepEntryRef = doc(collection(db, 'entries'));
            await setDoc(sleepEntryRef, {
              id: sleepEntryRef.id,
              description: 'night sleep',
              projectId: sleepProjectId,
              startTime: latestEndTime,
              endTime: now,
              duration: gapDuration,
              userId: user.uid
            });
          }
        } else if (gapDuration > 1000 && gapDuration < 12 * 60 * 60 * 1000) { // Only record if gap is > 1 second and < 12 hours
          const idleProjectId = await getOrCreateIdleProject();
          const idleEntryRef = doc(collection(db, 'entries'));
          await setDoc(idleEntryRef, {
            id: idleEntryRef.id,
            description: 'Idle (Stopped)',
            projectId: idleProjectId,
            startTime: latestEndTime,
            endTime: now,
            duration: gapDuration,
            userId: user.uid
          });
        }
      }
    }

    const newTimer = {
      description: draftDescription,
      projectId: draftProjectId,
      startTime: now,
      currentSegmentStartTime: now,
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
      const now = Date.now();
      const segmentStartTime = activeTimer.currentSegmentStartTime || activeTimer.startTime;
      const duration = now - segmentStartTime;

      // Record the work segment up to now
      if (duration > 0) {
        const workEntryRef = doc(collection(db, 'entries'));
        await setDoc(workEntryRef, {
          id: workEntryRef.id,
          description: activeTimer.description,
          projectId: activeTimer.projectId,
          startTime: segmentStartTime,
          endTime: now,
          duration: duration,
          userId: user.uid
        });
      }

      await updateDoc(doc(db, 'activeTimers', user.uid), {
        isPaused: true,
        lastPauseTime: now,
        currentSegmentStartTime: null
      });
    }
  };

  const handleResume = async () => {
    if (activeTimer && activeTimer.isPaused && activeTimer.lastPauseTime && user) {
      const now = Date.now();
      const pauseDuration = now - activeTimer.lastPauseTime;
      
      // 1. Record the pause as an entry
      if (pauseDuration > 0) {
        // Define night window for the current day (12 AM to 8 AM)
        const nightStart = new Date(now);
        nightStart.setHours(0, 0, 0, 0);
        const nightEnd = new Date(now);
        nightEnd.setHours(8, 0, 0, 0);

        // Check if pause is > 6 hours and crosses the night window
        const isNightSleep = pauseDuration >= 6 * 3600 * 1000 && 
                             activeTimer.lastPauseTime < nightEnd.getTime() && 
                             now > nightStart.getTime();

        if (isNightSleep) {
          const sleepProjectId = projects.find(p => p.name.toLowerCase() === 'sleep')?.id;
          if (sleepProjectId) {
            const sleepEntryRef = doc(collection(db, 'entries'));
            await setDoc(sleepEntryRef, {
              id: sleepEntryRef.id,
              description: 'night sleep',
              projectId: sleepProjectId,
              startTime: activeTimer.lastPauseTime,
              endTime: now,
              duration: pauseDuration,
              userId: user.uid
            });
          }
        } else {
          const idleProjectId = await getOrCreateIdleProject();
          const idleEntryRef = doc(collection(db, 'entries'));
          await setDoc(idleEntryRef, {
            id: idleEntryRef.id,
            description: 'Idle (Paused)',
            projectId: idleProjectId,
            startTime: activeTimer.lastPauseTime,
            endTime: now,
            duration: pauseDuration,
            userId: user.uid
          });
        }
      }

      // 2. Resume the main timer
      await updateDoc(doc(db, 'activeTimers', user.uid), {
        isPaused: false,
        totalPausedTime: activeTimer.totalPausedTime + pauseDuration,
        lastPauseTime: null,
        currentSegmentStartTime: now
      });
    }
  };

  const handleStop = async () => {
    if (activeTimer && user) {
      try {
        let endTime = Date.now();
        
        // If stopped while paused, we should record the final pause segment
        if (activeTimer.isPaused && activeTimer.lastPauseTime) {
          endTime = Math.max(endTime, activeTimer.lastPauseTime);
          const pauseDuration = endTime - activeTimer.lastPauseTime;
          if (pauseDuration > 0) {
            // Define night window for the current day (12 AM to 8 AM)
            const nightStart = new Date(endTime);
            nightStart.setHours(0, 0, 0, 0);
            const nightEnd = new Date(endTime);
            nightEnd.setHours(8, 0, 0, 0);

            // Check if pause is > 6 hours and crosses the night window
            const isNightSleep = pauseDuration >= 6 * 3600 * 1000 && 
                                 activeTimer.lastPauseTime < nightEnd.getTime() && 
                                 endTime > nightStart.getTime();

            if (isNightSleep) {
              const sleepProjectId = projects.find(p => p.name.toLowerCase() === 'sleep')?.id;
              if (sleepProjectId) {
                const sleepEntryRef = doc(collection(db, 'entries'));
                await setDoc(sleepEntryRef, {
                  id: sleepEntryRef.id,
                  description: 'night sleep',
                  projectId: sleepProjectId,
                  startTime: activeTimer.lastPauseTime,
                  endTime: endTime,
                  duration: pauseDuration,
                  userId: user.uid
                });
              }
            } else {
              const idleProjectId = await getOrCreateIdleProject();
              const idleEntryRef = doc(collection(db, 'entries'));
              await setDoc(idleEntryRef, {
                id: idleEntryRef.id,
                description: 'Idle (Paused)',
                projectId: idleProjectId,
                startTime: activeTimer.lastPauseTime,
                endTime: endTime,
                duration: pauseDuration,
                userId: user.uid
              });
            }
          }
        } else {
          // If stopped while active, record the final work segment
          const segmentStartTime = activeTimer.currentSegmentStartTime || activeTimer.startTime;
          endTime = Math.max(endTime, segmentStartTime);
          const duration = endTime - segmentStartTime;
          
          if (duration > 0) {
            const newEntryRef = doc(collection(db, 'entries'));
            const newEntry: TimeEntry = {
              id: newEntryRef.id,
              description: activeTimer.description,
              projectId: activeTimer.projectId,
              startTime: segmentStartTime,
              endTime: endTime,
              duration: duration,
              userId: user.uid
            };
            await setDoc(newEntryRef, newEntry);
          }
        }
        
        await deleteDoc(doc(db, 'activeTimers', user.uid));
        setDraftProjectId(activeTimer.projectId);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'entries/activeTimers');
      }
    }
  };

  const handleStopRef = useRef(handleStop);
  useEffect(() => {
    handleStopRef.current = handleStop;
  });

  useEffect(() => {
    if (!autoStopOnLock || !user || !activeTimer || activeTimer.isPaused) return;
    
    let controller = new AbortController();
    let isMounted = true;

    const setupIdleDetector = async () => {
      if (!('IdleDetector' in window)) return;
      
      try {
        const state = await (window as any).IdleDetector.requestPermission();
        if (state !== 'granted') {
          if (isMounted) {
            setAutoStopOnLock(false);
            localStorage.setItem('autoStopOnLock', 'false');
          }
          return;
        }

        const detector = new (window as any).IdleDetector();

        detector.addEventListener('change', () => {
          if (detector.screenState === 'locked') {
            handleStopRef.current();
          }
        });

        await detector.start({
          threshold: 60000,
          signal: controller.signal
        });
        
        // Check immediately after starting
        if (detector.screenState === 'locked') {
          handleStopRef.current();
        }

      } catch (err) {
        console.error('IdleDetector error:', err);
      }
    };

    setupIdleDetector();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [autoStopOnLock, user, activeTimer?.id, activeTimer?.isPaused]);

  const updateActiveTimer = async (updates: Partial<ActiveTimer>) => {
    if (activeTimer && user) {
      await updateDoc(doc(db, 'activeTimers', user.uid), updates);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(userCredential.user);
        setVerificationSent(true);
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        if (!userCredential.user.emailVerified) {
          // The UI will handle showing the verification screen
        }
      }
    } catch (error: any) {
      if (error.code === 'auth/operation-not-allowed') {
        setAuthError("Email/Password sign-in is not enabled in Firebase Console.");
      } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
        setAuthError("Incorrect email or password. Please check your credentials or sign up.");
      } else if (error.code === 'auth/email-already-in-use') {
        setAuthError("An account already exists with this email.");
      } else if (error.code === 'auth/weak-password') {
        setAuthError("Firebase requires passwords to be at least 6 characters long.");
      } else {
        setAuthError(error.message);
      }
    }
  };

  const handleDeleteAccount = () => {
    setIsDeleteModalOpen(true);
    setDeleteError('');
  };

  const executeDeleteAccount = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      setDeleteError('');
      
      // 1. Delete all entries
      try {
        const entriesQuery = query(collection(db, 'entries'), where('userId', '==', user.uid));
        const entriesSnapshot = await getDocs(entriesQuery);
        const entryDeletions = entriesSnapshot.docs.map(d => deleteDoc(d.ref));

        // 2. Delete all projects
        const projectsQuery = query(collection(db, 'projects'), where('userId', '==', user.uid));
        const projectsSnapshot = await getDocs(projectsQuery);
        const projectDeletions = projectsSnapshot.docs.map(d => deleteDoc(d.ref));

        // 3. Delete active timer
        const activeTimerRef = doc(db, 'activeTimers', user.uid);

        await Promise.all([...entryDeletions, ...projectDeletions, deleteDoc(activeTimerRef)]);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'entries/projects/activeTimers');
      }

      // 4. Delete user auth account
      await deleteUser(user);
      setIsDeleteModalOpen(false);
      // Firebase auth state listener will automatically handle the redirect to login screen
    } catch (error: any) {
      console.error("Error deleting account:", error);
      setIsLoading(false);
      if (error.code === 'auth/requires-recent-login') {
        setDeleteError("For security reasons, please sign out and sign in again before deleting your account.");
      } else {
        setDeleteError("Failed to delete account: " + error.message);
      }
    }
  };

  const groupedEntries = useMemo(() => {
    return groupByDay(entries);
  }, [entries]);

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
          <p className="text-gray-500 mb-6 text-sm">Sign in to sync your time across all your devices securely.</p>
          
          {authError && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 text-left">
              {authError}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="flex flex-col gap-3 mb-6">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input 
                type="email" 
                placeholder="Email address" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-700"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input 
                type="password" 
                placeholder="Password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-700"
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition-colors mt-1"
            >
              {isSignUp ? 'Create Account' : 'Sign In'}
            </button>
            <button 
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setAuthError(''); }}
              className="text-sm text-blue-600 hover:text-blue-800 transition-colors mt-1"
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </form>

          <div className="relative flex items-center py-2 mb-6">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="flex-shrink-0 mx-4 text-gray-400 text-xs font-medium uppercase">Or continue with</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          <button
            onClick={async () => {
              setAuthError('');
              try {
                await signInWithPopup(auth, googleProvider);
              } catch (error: any) {
                if (error.code === 'auth/configuration-not-found') {
                  setAuthError("Google Sign-In is not enabled in your Firebase Console.");
                } else if (error.code === 'auth/unauthorized-domain') {
                  const currentDomain = window.location.hostname;
                  setAuthError(`Domain "${currentDomain}" is not authorized. Please add it in Firebase Console -> Authentication -> Settings -> Authorized domains.`);
                } else if (error.code === 'auth/network-request-failed') {
                  setAuthError("Network error. Please check your internet connection or disable ad blockers.");
                } else if (error.code === 'auth/popup-closed-by-user') {
                  // User closed the popup, no need to show an error
                } else {
                  setAuthError(`Authentication failed: ${error.message}`);
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
            Google
          </button>
        </div>
      </div>
    );
  }

  if (user && !isEmailVerified && user.providerData.some(p => p.providerId === 'password')) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-sm w-full border border-gray-100">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Verify your email</h1>
          <p className="text-gray-500 mb-6 text-sm">
            We've sent a verification email to <strong className="text-gray-700">{user.email}</strong>. Please check your inbox and click the link to activate your account.
          </p>
          
          {verificationSent && (
            <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg border border-green-100">
              Verification email sent! Please check your inbox.
            </div>
          )}

          {verificationError && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
              {verificationError}
            </div>
          )}

          <button 
            onClick={async () => {
              if (user) {
                setIsCheckingVerification(true);
                setVerificationError('');
                try {
                  await user.reload();
                  if (auth.currentUser?.emailVerified) {
                    setIsEmailVerified(true);
                  } else {
                    setVerificationError("Your email is not verified yet. Please check your inbox and click the verification link.");
                  }
                } catch (error) {
                  console.error("Error reloading user:", error);
                }
                setIsCheckingVerification(false);
              }
            }} 
            disabled={isCheckingVerification}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition-colors mb-3 flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {isCheckingVerification ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Checking...
              </>
            ) : (
              "I've verified my email"
            )}
          </button>
          <button 
            onClick={async () => { 
              try {
                setVerificationError('');
                await sendEmailVerification(user); 
                setVerificationSent(true);
              } catch (e: any) {
                if (e.code === 'auth/too-many-requests') {
                  setVerificationError("Please wait a moment before requesting another email.");
                } else {
                  setVerificationError(e.message);
                }
              }
            }} 
            className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 rounded-xl transition-colors mb-6"
          >
            Resend Email
          </button>
          
          <button 
            onClick={() => signOut(auth)} 
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign out and use another account
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !activeTimer) {
                  handleStart();
                }
              }}
            />
            
            <div className="flex items-center justify-between">
              <ProjectSelector 
                projects={projects}
                projectGroups={projectGroups}
                selectedProjectId={activeTimer ? activeTimer.projectId : draftProjectId}
                onChange={(id) => activeTimer ? updateActiveTimer({ projectId: id }) : setDraftProjectId(id)}
                onAddProject={handleAddProject}
                onReorder={handleReorderProject}
                compact
              />
              
              <div className="flex items-center gap-4">
                <TimerDisplay activeTimer={activeTimer} className={`text-xl ${activeTimer?.isPaused ? 'text-gray-400' : 'text-gray-800'}`} />
                
                <div className="flex items-center gap-2">
                  {!activeTimer ? (
                    <div className="flex items-center gap-2">
                      <button onClick={handleStart} className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105">
                        <Play size={18} className="ml-1" />
                      </button>
                      <button 
                        onClick={() => {
                          const now = Date.now();
                          setEditingEntry({
                            id: 'new',
                            userId: user?.uid || '',
                            description: draftDescription,
                            projectId: draftProjectId,
                            startTime: now - 3600000,
                            endTime: now,
                            duration: 3600000
                          });
                        }} 
                        className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center shadow-sm transition-transform hover:scale-105"
                        title="Add Manual Entry"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  ) : (
                    <>
                      {activeTimer.isPaused ? (
                        <button 
                          onClick={handleResume} 
                          onMouseEnter={() => setHoveredButton('resume')}
                          onMouseLeave={() => setHoveredButton(null)}
                          className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105"
                        >
                          <Play size={18} className="ml-1" />
                        </button>
                      ) : (
                        <button 
                          onClick={handlePause} 
                          onMouseEnter={() => setHoveredButton('pause')}
                          onMouseLeave={() => setHoveredButton(null)}
                          className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105"
                        >
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
          <button 
            onClick={() => setCurrentView('recycle-bin')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors ${currentView === 'recycle-bin' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <RotateCcw size={18} /> Recycle Bin
          </button>
          <button 
            onClick={() => setCurrentView('settings')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors ${currentView === 'settings' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Settings size={18} /> Settings
          </button>
        </nav>
        <div className="p-4 border-t border-gray-200 flex flex-col gap-2">
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-gray-500 font-medium">
            {user?.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || 'User'} className="w-6 h-6 rounded-full bg-gray-200" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <span className="truncate">{user?.displayName || user?.email || 'User'}</span>
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !activeTimer) {
                      handleStart();
                    }
                  }}
                />
                
                <div className="flex items-center justify-between w-full md:w-auto gap-2 md:gap-6">
                  <ProjectSelector 
                    projects={projects}
                    projectGroups={projectGroups}
                    selectedProjectId={activeTimer ? activeTimer.projectId : draftProjectId}
                    onChange={(id) => activeTimer ? updateActiveTimer({ projectId: id }) : setDraftProjectId(id)}
                    onAddProject={handleAddProject}
                    onReorder={handleReorderProject}
                  />
                  
                  <div className="hidden md:block h-6 w-px bg-gray-200"></div>
                  
                  <div className="flex items-center gap-4 md:gap-6">
                    <TimerDisplay activeTimer={activeTimer} className={`text-xl font-mono md:w-24 text-right ${activeTimer?.isPaused ? 'text-gray-400' : 'text-gray-800'}`} />
                    
                    <div className="flex items-center gap-2">
                      {!activeTimer ? (
                        <div className="flex items-center gap-1">
                          <button onClick={handleStart} className="w-20 md:w-24 h-10 rounded bg-blue-500 hover:bg-blue-600 text-white font-medium flex items-center justify-center transition-colors cursor-pointer">
                            START
                          </button>
                          <button 
                            onClick={() => {
                              const now = Date.now();
                              setEditingEntry({
                                id: 'new',
                                userId: user?.uid || '',
                                description: draftDescription,
                                projectId: draftProjectId,
                                startTime: now - 3600000, // Default 1 hour ago
                                endTime: now,
                                duration: 3600000
                              });
                            }} 
                            className="w-10 h-10 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
                            title="Add Manual Entry"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {activeTimer.isPaused ? (
                            <button 
                              onClick={handleResume} 
                              onMouseEnter={() => setHoveredButton('resume')}
                              onMouseLeave={() => setHoveredButton(null)}
                              className="w-20 md:w-24 h-10 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium flex items-center justify-center transition-colors cursor-pointer"
                            >
                              RESUME
                            </button>
                          ) : (
                            <button 
                              onClick={handlePause} 
                              onMouseEnter={() => setHoveredButton('pause')}
                              onMouseLeave={() => setHoveredButton(null)}
                              className="w-20 md:w-24 h-10 rounded bg-amber-100 hover:bg-amber-200 text-amber-700 font-medium flex items-center justify-center transition-colors cursor-pointer"
                            >
                              PAUSE
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
                    const dayEntriesList = dayEntries as TimeEntry[];
                    const nonSleepEntries = dayEntriesList.filter(e => projects.find(p => p.id === e.projectId)?.name.toLowerCase() !== 'sleep');
                    const dayTotal = nonSleepEntries.reduce((acc, entry) => acc + entry.duration, 0);
                    
                    return (
                      <div key={date} className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-2 text-sm text-gray-500 font-medium">
                          <span>{formatDateStr(date)}</span>
                          <span className="flex items-center gap-3">
                            <span>
                              {(() => {
                                const idleTime = nonSleepEntries.filter(e => e.description.startsWith('Idle (') || projects.find(p => p.id === e.projectId)?.name.toLowerCase() === 'idle').reduce((acc, e) => acc + e.duration, 0);
                                const nonIdleTime = dayTotal - idleTime;
                                const percentage = dayTotal > 0 ? Math.round((nonIdleTime / dayTotal) * 100) : 0;
                                return `Total: ${formatDuration(nonIdleTime)} (${percentage}%) / ${formatDuration(dayTotal)}`;
                              })()}
                            </span>
                          </span>
                        </div>
                        
                        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                          {dayEntriesList.map((entry, index) => {
                            const project = projects.find(p => p.id === entry.projectId);
                            return (
                              <div 
                                key={entry.id} 
                                onDoubleClick={() => setEditingEntry(entry)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setOpenDropdownId(openDropdownId === entry.id ? null : entry.id);
                                }}
                                className={`flex flex-col md:flex-row md:items-center justify-between p-4 hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${index !== dayEntriesList.length - 1 ? 'border-b border-gray-100' : ''}`}
                              >
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
                                          {entry.id === entries[0]?.id && !activeTimer && (
                                            <button 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleContinueEntry(entry);
                                                setOpenDropdownId(null);
                                              }}
                                              className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2"
                                            >
                                              <Play size={14} /> Continue
                                            </button>
                                          )}
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingEntry(entry);
                                              setOpenDropdownId(null);
                                            }}
                                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                          >
                                            <Settings size={14} /> Edit
                                          </button>
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
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsAddingFolder(true)}
                    className="flex items-center gap-2 px-3 py-2 md:px-4 md:py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors text-sm md:text-base"
                  >
                    <Folder size={18} /> <span className="hidden sm:inline">New Folder</span><span className="sm:hidden">Folder</span>
                  </button>
                  <button 
                    onClick={() => setIsAddingProject(true)}
                    className="flex items-center gap-2 px-3 py-2 md:px-4 md:py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors text-sm md:text-base"
                  >
                    <Plus size={18} /> <span className="hidden sm:inline">New Project</span><span className="sm:hidden">Project</span>
                  </button>
                </div>
              </div>

              {isAddingFolder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">New Folder</h2>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Folder name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6"
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newFolderName.trim()) {
                          handleAddFolder(newFolderName.trim());
                          setNewFolderName('');
                          setIsAddingFolder(false);
                        }
                      }}
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => {
                          setIsAddingFolder(false);
                          setNewFolderName('');
                        }}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (newFolderName.trim()) {
                            handleAddFolder(newFolderName.trim());
                            setNewFolderName('');
                            setIsAddingFolder(false);
                          }
                        }}
                        disabled={!newFolderName.trim()}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Create
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                          handleAddProject(newProjectName.trim(), colors[Math.floor(Math.random() * colors.length)], addingToGroupId || undefined);
                          setNewProjectName('');
                          setIsAddingProject(false);
                          setAddingToGroupId(null);
                        }
                      }}
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => {
                          setIsAddingProject(false);
                          setNewProjectName('');
                          setAddingToGroupId(null);
                        }}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (newProjectName.trim()) {
                            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4'];
                            handleAddProject(newProjectName.trim(), colors[Math.floor(Math.random() * colors.length)], addingToGroupId || undefined);
                            setNewProjectName('');
                            setIsAddingProject(false);
                            setAddingToGroupId(null);
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

              {editingProject && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">Edit Project</h2>
                    <div className="flex flex-col gap-4 mb-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={editingProject.name}
                          onChange={e => setEditingProject({...editingProject, name: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                        <input
                          type="color"
                          className="w-full h-10 p-1 border border-gray-300 rounded-lg cursor-pointer"
                          value={editingProject.color}
                          onChange={e => setEditingProject({...editingProject, color: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Folder</label>
                        <select
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          value={editingProject.groupId || ''}
                          onChange={e => setEditingProject({...editingProject, groupId: e.target.value || null})}
                        >
                          <option value="">None (Root)</option>
                          {projectGroups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <button
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this project?")) {
                            handleDeleteProject(editingProject.id);
                            setEditingProject(null);
                          }
                        }}
                        className="text-red-600 hover:text-red-700 font-medium text-sm flex items-center gap-1"
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setEditingProject(null)}
                          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (editingProject.name.trim()) {
                              handleUpdateProject(editingProject.id, {
                                name: editingProject.name.trim(),
                                color: editingProject.color,
                                groupId: editingProject.groupId
                              });
                              setEditingProject(null);
                            }
                          }}
                          disabled={!editingProject.name.trim()}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {editingFolder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
                    <h2 className="text-xl font-bold text-gray-800 mb-4">Edit Folder</h2>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Folder name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6"
                      value={editingFolder.name}
                      onChange={e => setEditingFolder({...editingFolder, name: e.target.value})}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && editingFolder.name.trim()) {
                          handleUpdateFolder(editingFolder.id, { name: editingFolder.name.trim() });
                          setEditingFolder(null);
                        }
                      }}
                    />
                    <div className="flex justify-between items-center">
                      <button
                        onClick={() => {
                          handleDeleteFolder(editingFolder.id);
                          setEditingFolder(null);
                        }}
                        className="text-red-600 hover:text-red-700 font-medium text-sm flex items-center gap-1"
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setEditingFolder(null)}
                          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (editingFolder.name.trim()) {
                              handleUpdateFolder(editingFolder.id, { name: editingFolder.name.trim() });
                              setEditingFolder(null);
                            }
                          }}
                          disabled={!editingFolder.name.trim()}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <div 
                className="bg-white border border-gray-200 rounded-lg shadow-sm min-h-[100px]"
                onDragOver={handleDragOver}
                onDrop={handleDropToRoot}
              >
                {projectGroups.map(group => {
                  const groupProjects = projects.filter(p => p.groupId === group.id);
                  const isExpanded = expandedFolders[group.id] ?? group.isExpanded ?? true;
                  
                  return (
                    <div key={group.id} className="border-b border-gray-100 last:border-0">
                      <div 
                        draggable
                        onDragStart={(e) => handleFolderDragStart(e, group.id)}
                        className={`flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer ${draggedFolderId === group.id ? 'opacity-50' : ''}`}
                        onClick={() => toggleFolderExpand(group.id)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setAddingToGroupId(group.id);
                          setIsAddingProject(true);
                        }}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, group.id, true)}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown size={18} className="text-gray-500" /> : <ChevronRight size={18} className="text-gray-500" />}
                          <Folder size={18} className="text-blue-500" />
                          <span className="font-semibold text-gray-800">{group.name}</span>
                          <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{groupProjects.length}</span>
                        </div>
                        <div className={`relative ${openDropdownId === group.id ? 'z-10' : ''}`}>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId(openDropdownId === group.id ? null : group.id);
                            }}
                            className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-200 transition-colors cursor-pointer"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {openDropdownId === group.id && (
                            <div className="absolute right-0 mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAddingToGroupId(group.id);
                                  setIsAddingProject(true);
                                  setOpenDropdownId(null);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Plus size={14} /> New Project
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingFolder(group);
                                  setOpenDropdownId(null);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Settings size={14} /> Edit
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteFolder(group.id);
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
                      
                      {isExpanded && (
                        <div className="pl-6">
                          {groupProjects.length === 0 ? (
                            <div className="p-4 text-sm text-gray-400 italic">Empty folder. Drag projects here.</div>
                          ) : (
                            groupProjects.map((project, index) => (
                              <div 
                                key={project.id} 
                                draggable
                                onDragStart={(e) => handleDragStart(e, project.id)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, project.id)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  setEditingProject(project);
                                }}
                                className={`flex items-center justify-between p-3 hover:bg-blue-50 transition-colors cursor-move ${draggedProjectId === project.id ? 'opacity-50' : ''} ${index !== groupProjects.length - 1 ? 'border-b border-gray-50' : ''}`}
                              >
                                <div className="flex items-center gap-3">
                                  <span className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: project.color }}></span>
                                  <span className="font-medium text-gray-700">{project.name}</span>
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
                                          setEditingProject(project);
                                          setOpenDropdownId(null);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                      >
                                        <Settings size={14} /> Edit
                                      </button>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (window.confirm("Are you sure you want to delete this project?")) {
                                            handleDeleteProject(project.id);
                                          }
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
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Standalone Projects */}
                {projects.filter(p => !p.groupId).map((project, index, arr) => (
                  <div 
                    key={project.id} 
                    draggable
                    onDragStart={(e) => handleDragStart(e, project.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, project.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingProject(project);
                    }}
                    className={`flex items-center justify-between p-4 hover:bg-gray-50 transition-colors cursor-move ${draggedProjectId === project.id ? 'opacity-50' : ''} ${index !== arr.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: project.color }}></span>
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
                              setEditingProject(project);
                              setOpenDropdownId(null);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Settings size={14} /> Edit
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm("Are you sure you want to delete this project?")) {
                                handleDeleteProject(project.id);
                              }
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
                {projects.length === 0 && projectGroups.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    No projects yet. Create one to get started!
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === 'reports' && (
          <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
            <div className="max-w-5xl mx-auto flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h1 className="text-2xl font-bold text-gray-800">Reports</h1>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex bg-gray-200 p-1 rounded-lg">
                    {(['day', 'week', 'month', 'year'] as const).map(range => (
                      <button
                        key={range}
                        onClick={() => setReportTimeRange(range)}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${reportTimeRange === range ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        {range === 'day' ? 'Today' : range === 'week' ? 'Last 7 Days' : `This ${range}`}
                      </button>
                    ))}
                  </div>
                  <div className="flex bg-gray-200 p-1 rounded-lg">
                    <button
                      onClick={() => setReportView('stats')}
                      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${reportView === 'stats' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <BarChart2 size={16} className="inline mr-1" /> Stats
                    </button>
                    <button
                      onClick={() => setReportView('timeline')}
                      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${reportView === 'timeline' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <List size={16} className="inline mr-1" /> Timeline
                    </button>
                  </div>
                </div>
              </div>
              
              {reportView === 'stats' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
                <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm flex flex-col gap-2">
                  <span className="text-sm text-gray-500 font-medium uppercase tracking-wider">Total Time</span>
                  <span className="text-3xl font-mono font-bold text-gray-800">
                    {formatDuration(filteredReportEntries.reduce((acc, e) => acc + e.duration, 0))}
                  </span>
                </div>
                <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm flex flex-col gap-2">
                  <span className="text-sm text-gray-500 font-medium uppercase tracking-wider">Total Entries</span>
                  <span className="text-3xl font-bold text-gray-800">{filteredReportEntries.length}</span>
                </div>
                <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm flex flex-col gap-2">
                  <span className="text-sm text-gray-500 font-medium uppercase tracking-wider">Active Projects</span>
                  <span className="text-3xl font-bold text-gray-800">
                    {new Set(filteredReportEntries.map(e => e.projectId).filter(Boolean)).size}
                  </span>
                </div>
              </div>

              {/* Daily Trend Chart Section */}
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mt-4">
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-semibold text-gray-800">Daily Trend</h2>
                </div>
                <div className="p-4 h-80">
                  {(() => {
                    const dailyChartData = Object.entries(groupByDay(filteredReportEntries))
                      .map(([date, dayEntries]) => {
                        const dayTotal = dayEntries.reduce((acc, e) => acc + e.duration, 0);
                        const idleTime = dayEntries.filter(e => e.description.startsWith('Idle (') || projects.find(p => p.id === e.projectId)?.name.toLowerCase() === 'idle').reduce((acc, e) => acc + e.duration, 0);
                        const nonIdleTime = dayTotal - idleTime;
                        const percent = dayTotal > 0 ? Math.round((nonIdleTime / dayTotal) * 100) : 0;
                        const nonIdleHours = (nonIdleTime / (1000 * 60 * 60)).toFixed(1);
                        return {
                          date: formatDateStr(date),
                          timestamp: new Date(date).getTime(),
                          total: dayTotal,
                          nonIdle: nonIdleTime,
                          idle: idleTime,
                          percentStr: `${percent}%`,
                          nonIdleHoursStr: nonIdleTime > 0 ? nonIdleHours : ''
                        };
                      })
                      .sort((a, b) => a.timestamp - b.timestamp);

                    if (dailyChartData.length === 0) {
                      return <div className="h-full flex items-center justify-center text-gray-500">No data available</div>;
                    }

                    const CustomDailyTooltip = ({ active, payload, label }: any) => {
                      if (active && payload && payload.length) {
                        const total = payload.find((p: any) => p.dataKey === 'total')?.value || 0;
                        const nonIdle = payload.find((p: any) => p.dataKey === 'nonIdle')?.value || 0;
                        const percent = total > 0 ? ((nonIdle / total) * 100).toFixed(1) : 0;
                        return (
                          <div className="bg-white p-3 border border-gray-200 shadow-sm rounded text-sm z-50">
                            <p className="font-medium text-gray-800 mb-2">{label}</p>
                            <div className="flex flex-col gap-1">
                              <p className="text-gray-600 font-mono flex justify-between gap-4">
                                <span>Total:</span> <span>{formatDuration(total)}</span>
                              </p>
                              <p className="text-indigo-600 font-mono flex justify-between gap-4">
                                <span>Non-Idle:</span> <span>{formatDuration(nonIdle)} ({percent}%)</span>
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    };

                    return (
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <BarChart data={dailyChartData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                          <XAxis 
                            dataKey="date" 
                            xAxisId="a"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 12, fill: '#6b7280' }}
                            dy={10}
                          />
                          <XAxis dataKey="date" xAxisId="b" hide />
                          <YAxis 
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 12, fill: '#6b7280' }}
                            tickFormatter={(value) => {
                              const hours = Math.floor(value / (1000 * 60 * 60));
                              return hours > 0 ? `${hours}h` : '';
                            }}
                          />
                          <RechartsTooltip content={<CustomDailyTooltip />} cursor={{ fill: '#f3f4f6' }} />
                          <Legend wrapperStyle={{ paddingTop: '20px' }} />
                          <Bar dataKey="total" xAxisId="a" name="Total Time" fill="#e5e7eb" radius={[4, 4, 0, 0]}>
                            <LabelList dataKey="nonIdleHoursStr" position="top" fill="#6b7280" fontSize={12} />
                          </Bar>
                          <Bar dataKey="nonIdle" xAxisId="b" name="Non-Idle Time" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  })()}
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
                      const totalDuration = filteredReportEntries.reduce((acc, e) => acc + e.duration, 0);
                      const chartData = projects.map(p => {
                        const duration = filteredReportEntries.filter(e => e.projectId === p.id).reduce((acc, e) => acc + e.duration, 0);
                        return { name: p.name, value: duration, color: p.color, id: p.id };
                      }).filter(d => d.value > 0);

                      const noProjectDuration = filteredReportEntries.filter(e => !e.projectId).reduce((acc, e) => acc + e.duration, 0);
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
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
                            ? filteredReportEntries.filter(e => !e.projectId) 
                            : filteredReportEntries.filter(e => e.projectId === selectedChartProject);
                          
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
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
                  <h2 className="font-semibold text-gray-800">Time by Project (Bar Chart)</h2>
                </div>
                <div className="p-4 flex flex-col md:flex-row gap-6">
                  <div className="w-full md:w-1/2 h-80">
                    {(() => {
                      const totalDuration = filteredReportEntries.reduce((acc, e) => acc + e.duration, 0);
                      const chartData = projects.map(p => {
                        const duration = filteredReportEntries.filter(e => e.projectId === p.id).reduce((acc, e) => acc + e.duration, 0);
                        return { name: p.name, value: duration, color: p.color, id: p.id };
                      }).filter(d => d.value > 0);

                      const noProjectDuration = filteredReportEntries.filter(e => !e.projectId).reduce((acc, e) => acc + e.duration, 0);
                      if (noProjectDuration > 0) {
                        chartData.push({ name: 'No Project', value: noProjectDuration, color: '#9ca3af', id: 'no-project' });
                      }

                      chartData.sort((a, b) => b.value - a.value);

                      const CustomBarTooltip = ({ active, payload }: any) => {
                        if (active && payload && payload.length) {
                          const percent = totalDuration > 0 ? ((payload[0].value / totalDuration) * 100).toFixed(1) : 0;
                          return (
                            <div className="bg-white p-2 border border-gray-200 shadow-sm rounded text-sm">
                              <p className="font-medium text-gray-800">{payload[0].payload.name}</p>
                              <p className="text-gray-600 font-mono">{formatDuration(payload[0].value)} ({percent}%)</p>
                            </div>
                          );
                        }
                        return null;
                      };

                      return chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                            <XAxis 
                              dataKey="name" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 12, fill: '#6b7280' }} 
                              dy={10} 
                            />
                            <YAxis 
                              tickFormatter={(val) => `${Math.floor(val / 3600000)}h`} 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 12, fill: '#6b7280' }} 
                            />
                            <RechartsTooltip content={<CustomBarTooltip />} cursor={{ fill: '#f3f4f6' }} />
                            <Bar 
                              dataKey="value" 
                              radius={[4, 4, 0, 0]} 
                              maxBarSize={60}
                              onClick={(data) => setSelectedBarProject(selectedBarProject === data.id ? null : data.id)}
                              className="cursor-pointer"
                            >
                              {chartData.map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={entry.color} 
                                  stroke={selectedBarProject === entry.id ? '#000' : 'none'} 
                                  strokeWidth={selectedBarProject === entry.id ? 2 : 0} 
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-gray-400 text-sm">No data to display</div>
                      );
                    })()}
                  </div>
                  
                  <div className="w-full md:w-1/2 flex flex-col h-80">
                    <h3 className="font-medium text-gray-700 mb-3 border-b border-gray-100 pb-2 flex-shrink-0">
                      {selectedBarProject ? (
                        selectedBarProject === 'no-project' ? 'No Project Details' : projects.find(p => p.id === selectedBarProject)?.name + ' Details'
                      ) : (
                        'Click a bar to view details'
                      )}
                    </h3>
                    
                    {selectedBarProject ? (
                      <div className="flex flex-col h-full overflow-hidden">
                        {(() => {
                          const projectEntries = selectedBarProject === 'no-project' 
                            ? filteredReportEntries.filter(e => !e.projectId) 
                            : filteredReportEntries.filter(e => e.projectId === selectedBarProject);
                          
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

                          const DrillDownBarTooltip = ({ active, payload }: any) => {
                            if (active && payload && payload.length) {
                              const percent = projectTotalDuration > 0 ? ((payload[0].value / projectTotalDuration) * 100).toFixed(1) : 0;
                              return (
                                <div className="bg-white p-2 border border-gray-200 shadow-sm rounded text-sm z-50">
                                  <p className="font-medium text-gray-800">{payload[0].payload.name}</p>
                                  <p className="text-gray-600 font-mono">{formatDuration(payload[0].value)} ({percent}%)</p>
                                </div>
                              );
                            }
                            return null;
                          };

                          return (
                            <>
                              <div className="h-56 flex-shrink-0 mb-2">
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                  <BarChart data={drillDownData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                    <XAxis 
                                      dataKey="name" 
                                      axisLine={false} 
                                      tickLine={false} 
                                      tick={{ fontSize: 10, fill: '#6b7280' }} 
                                      dy={10} 
                                      tickFormatter={(val) => val.length > 10 ? val.substring(0, 10) + '...' : val}
                                    />
                                    <YAxis 
                                      tickFormatter={(val) => `${Math.floor(val / 3600000)}h`} 
                                      axisLine={false} 
                                      tickLine={false} 
                                      tick={{ fontSize: 10, fill: '#6b7280' }} 
                                    />
                                    <RechartsTooltip content={<DrillDownBarTooltip />} cursor={{ fill: '#f3f4f6' }} />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
                                      {drillDownData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                      ))}
                                    </Bar>
                                  </BarChart>
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

              <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mt-4">
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                  <h2 className="font-semibold text-gray-800">Project Details</h2>
                </div>
                <div className="p-4 flex flex-col gap-4">
                  {projects.map(project => {
                    const projectEntries = filteredReportEntries.filter(e => e.projectId === project.id);
                    const projectTime = projectEntries.reduce((acc, e) => acc + e.duration, 0);
                    
                    if (projectTime === 0) return null;

                    const totalTime = filteredReportEntries.reduce((acc, e) => acc + e.duration, 0);
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
                    const noProjectEntries = filteredReportEntries.filter(e => !e.projectId);
                    const noProjectTime = noProjectEntries.reduce((acc, e) => acc + e.duration, 0);
                    
                    if (noProjectTime === 0) return null;
                    
                    const totalTime = filteredReportEntries.reduce((acc, e) => acc + e.duration, 0);
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
                  {filteredReportEntries.length === 0 && (
                    <div className="text-center text-gray-500 py-4 text-sm">
                      No data available yet.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-8">
              {Object.entries(groupByDay(filteredReportEntriesWithSleep))
                .sort(([dateA], [dateB]) => new Date(dateB).getTime() - new Date(dateA).getTime())
                .map(([date, dayEntries]) => (
                  <div key={date} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                      <h3 className="font-bold text-gray-800">{formatDateStr(date)}</h3>
                      <span className="text-sm font-mono text-gray-500">
                        {(() => {
                          const nonSleepEntries = dayEntries.filter(e => projects.find(p => p.id === e.projectId)?.name.toLowerCase() !== 'sleep');
                          const dayTotal = nonSleepEntries.reduce((acc, e) => acc + e.duration, 0);
                          const idleTime = nonSleepEntries.filter(e => e.description.startsWith('Idle (') || projects.find(p => p.id === e.projectId)?.name.toLowerCase() === 'idle').reduce((acc, e) => acc + e.duration, 0);
                          const nonIdleTime = dayTotal - idleTime;
                          const percentage = dayTotal > 0 ? Math.round((nonIdleTime / dayTotal) * 100) : 0;
                          return `Total: ${formatDuration(nonIdleTime)} (${percentage}%) / ${formatDuration(dayTotal)}`;
                        })()}
                      </span>
                    </div>
                    <div className="p-6">
                      <div className="relative border-l-2 border-gray-100 ml-4 pl-8 flex flex-col gap-6">
                        {dayEntries.sort((a, b) => b.startTime - a.startTime).map((entry, idx) => {
                          const project = projects.find(p => p.id === entry.projectId);
                          return (
                            <div key={entry.id} className="relative">
                              {/* Dot on the line */}
                              <div 
                                className="absolute -left-[41px] top-1.5 w-4 h-4 rounded-full border-2 border-white shadow-sm"
                                style={{ backgroundColor: project?.color || '#9ca3af' }}
                              ></div>
                              
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-gray-800">{entry.description || 'No description'}</span>
                                    {project && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: project.color }}>
                                        {project.name}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs text-gray-500 font-mono">
                                    {formatTime(entry.startTime)} — {formatTime(entry.endTime)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className="font-mono text-sm text-gray-900 font-bold bg-gray-200 px-2 py-1 rounded shadow-sm">
                                    {formatDuration(entry.duration)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              {filteredReportEntriesWithSleep.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400 bg-white border border-gray-200 rounded-lg">
                  <Clock size={48} className="mb-4 opacity-20" />
                  <p className="text-lg">No data for this period</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )}
        {currentView === 'settings' && (
          <div className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-8">
            <div className="max-w-2xl mx-auto">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Settings</h2>
              
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">Account Information</h3>
                  <p className="text-sm text-gray-500 mb-4">Manage your account details and preferences.</p>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="relative group">
                        {userAvatar ? (
                          <img src={userAvatar} alt={user?.displayName || 'User'} className="w-16 h-16 rounded-full object-cover bg-gray-200" />
                        ) : user?.photoURL ? (
                          <img src={user.photoURL} alt={user.displayName || 'User'} className="w-16 h-16 rounded-full bg-gray-200" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-2xl font-bold">
                            {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <label className="absolute inset-0 flex items-center justify-center bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                          <ImageIcon size={20} />
                          <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                        </label>
                      </div>
                      <div>
                        <div className="font-medium text-gray-800 text-lg">{user?.displayName || 'User'}</div>
                        <div className="text-gray-500">{user?.email}</div>
                      </div>
                    </div>
                    <button 
                      onClick={() => signOut(auth)} 
                      className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors flex items-center gap-2"
                    >
                      <LogOut size={16} /> Sign Out
                    </button>
                  </div>
                </div>
                
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">Data Management</h3>
                  <p className="text-sm text-gray-500 mb-4">Export your time entries as JSON or import a backup.</p>
                  
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button 
                      onClick={handleExport}
                      className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Download size={16} /> Export Data
                    </button>
                    <label className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer">
                      <Upload size={16} /> Import Data
                      <input type="file" accept=".json" className="hidden" onChange={handleImport} />
                    </label>
                  </div>
                </div>

                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">App Customization</h3>
                  <p className="text-sm text-gray-500 mb-4">Customize the application icon.</p>
                  
                  <div className="flex items-center gap-4">
                    <div className="relative group">
                      {appIcon ? (
                        <img src={appIcon} alt="App Icon" className="w-16 h-16 rounded-xl object-cover bg-gray-200 shadow-sm" />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shadow-sm">
                          <Clock size={32} />
                        </div>
                      )}
                      <label className="absolute inset-0 flex items-center justify-center bg-black/50 text-white rounded-xl opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                        <ImageIcon size={20} />
                        <input type="file" accept="image/*" className="hidden" onChange={handleAppIconUpload} />
                      </label>
                    </div>
                    <div>
                      <div className="font-medium text-gray-800 text-lg">Taskbar / App Icon</div>
                      <div className="text-gray-500 text-sm">Upload a square image (e.g., 512x512)</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">App Preferences</h3>
                  <p className="text-sm text-gray-500 mb-4">Customize how the tracker behaves.</p>
                  
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="font-medium text-gray-800">Auto-stop on screen lock</div>
                      <div className="text-sm text-gray-500">Automatically stop the active timer when your computer screen locks. (Requires browser permission, supported on Chromium browsers only)</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={autoStopOnLock}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          if (checked) {
                            if ('IdleDetector' in window) {
                              try {
                                const state = await (window as any).IdleDetector.requestPermission();
                                if (state === 'granted') {
                                  setAutoStopOnLock(true);
                                  localStorage.setItem('autoStopOnLock', 'true');
                                } else {
                                  alert('Permission to detect idle state was denied. Please enable it in your browser settings.');
                                }
                              } catch (err) {
                                console.error('Error requesting IdleDetector permission:', err);
                                alert('Failed to request permission. Ensure you are using a supported browser.');
                              }
                            } else {
                              alert('Your browser does not support the Idle Detection API. Please use Chrome or Edge.');
                            }
                          } else {
                            setAutoStopOnLock(false);
                            localStorage.setItem('autoStopOnLock', 'false');
                          }
                        }}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
                <div className="p-6 border-b border-red-100">
                  <h3 className="text-lg font-semibold text-red-600 mb-1">Danger Zone</h3>
                  <p className="text-sm text-gray-500">Permanently delete your account and all associated data.</p>
                </div>
                
                <div className="p-6 bg-red-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="text-sm text-gray-600 max-w-md">
                    Once you delete your account, there is no going back. All your tracked time, projects, and settings will be permanently removed from our servers.
                  </div>
                  <button 
                    onClick={handleDeleteAccount} 
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors whitespace-nowrap flex-shrink-0"
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentView === 'recycle-bin' && (
          <div className="flex-1 overflow-y-auto p-6 pb-32 bg-gray-50">
            <div className="max-w-5xl mx-auto flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-800">Recycle Bin</h1>
                <div className="text-sm text-gray-500 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                  Entries are kept for 2 days
                </div>
              </div>

              {deletedEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400 bg-white rounded-xl border border-dashed border-gray-300">
                  <RotateCcw size={48} className="mb-4 opacity-20" />
                  <p className="text-lg">Recycle bin is empty</p>
                  <p className="text-sm">Deleted entries will appear here for 2 days</p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                  {deletedEntries.map((entry, index) => {
                    const project = projects.find(p => p.id === entry.projectId);
                    const deletedDate = new Date(entry.deletedAt);

                    return (
                      <div key={entry.id} className={`flex flex-col md:flex-row md:items-center justify-between p-4 hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${index !== deletedEntries.length - 1 ? 'border-b border-gray-100' : ''}`}>
                        <div className="flex flex-col gap-1 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${!entry.description ? 'text-gray-400 italic' : 'text-gray-800'}`}>
                              {entry.description || '(no description)'}
                            </span>
                            {project && (
                              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: `${project.color}15`, color: project.color }}>
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: project.color }}></span>
                                {project.name}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-3">
                            <span>{formatDateStr(new Date(entry.startTime).toISOString().split('T')[0])}</span>
                            <span>{formatTime(entry.startTime)} - {formatTime(entry.endTime)}</span>
                            <span className="font-mono">{formatDuration(entry.duration)}</span>
                          </div>
                          <div className="text-[10px] text-red-500 font-medium mt-1">
                            Deleted on: {deletedDate.toLocaleString()}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-3 md:mt-0">
                          <button 
                            onClick={() => handleRestoreEntry(entry.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md text-sm font-medium hover:bg-blue-100 transition-colors"
                          >
                            <RotateCcw size={14} /> Restore
                          </button>
                          <button 
                            onClick={() => handlePermanentDeleteEntry(entry.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-sm font-medium hover:bg-red-100 transition-colors"
                            title="Delete Permanently"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {editingEntry && (
          <EditEntryModal
            entry={editingEntry}
            projects={projects}
            projectGroups={projectGroups}
            onSave={handleEditEntrySave}
            onClose={() => setEditingEntry(null)}
            onAddProject={handleAddProject}
          />
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
        <button 
          onClick={() => setCurrentView('recycle-bin')} 
          className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'recycle-bin' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <RotateCcw size={20} />
          <span className="text-[10px] font-medium mt-1">Recycle</span>
        </button>
        <button 
          onClick={() => setCurrentView('settings')} 
          className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'settings' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <Settings size={20} />
          <span className="text-[10px] font-medium mt-1">Settings</span>
        </button>
      </nav>
      {/* Delete Account Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Account?</h3>
            <p className="text-gray-600 mb-6 text-sm">
              This will permanently delete your account and <strong>ALL</strong> your tracked time and projects. This action <strong>CANNOT</strong> be undone. Are you sure?
            </p>
            
            {deleteError && (
              <div className="mb-6 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                {deleteError}
              </div>
            )}
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setIsDeleteModalOpen(false)} 
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button 
                onClick={executeDeleteAccount} 
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Deleting...
                  </>
                ) : (
                  'Yes, Delete My Account'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
