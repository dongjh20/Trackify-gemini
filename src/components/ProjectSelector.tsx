import React, { useState, useRef, useEffect } from 'react';
import { Folder, PlusCircle, Plus } from 'lucide-react';
import { Project } from '../types';

interface Props {
  projects: Project[];
  selectedProjectId: string | null;
  onChange: (id: string | null) => void;
  onAddProject?: (name: string, color: string) => void;
  compact?: boolean;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4'];

export function ProjectSelector({ projects, selectedProjectId, onChange, onAddProject, compact = false }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const selected = projects.find(p => p.id === selectedProjectId);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  const filteredProjects = projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const showCreateOption = searchQuery.trim().length > 0 && !projects.some(p => p.name.toLowerCase() === searchQuery.trim().toLowerCase());

  const handleCreate = () => {
    if (onAddProject && searchQuery.trim()) {
      const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      onAddProject(searchQuery.trim(), randomColor);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className={`flex items-center gap-2 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors ${compact ? 'text-sm' : ''}`}
      >
        {selected ? (
          <>
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selected.color }}></span>
            <span className="text-gray-700 truncate max-w-[100px]">{selected.name}</span>
          </>
        ) : (
          <>
            <PlusCircle size={16} className="text-blue-500 flex-shrink-0" />
            <span className="text-blue-500 font-medium">Project</span>
          </>
        )}
      </button>
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-50 flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              placeholder="Find or create project..."
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && showCreateOption) {
                  handleCreate();
                }
              }}
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            <button 
              onClick={() => { onChange(null); setIsOpen(false); }} 
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded flex items-center gap-2 text-gray-600"
            >
              <Folder size={14} /> No project
            </button>
            <div className="h-px bg-gray-100 my-1"></div>
            {filteredProjects.map(p => (
              <button 
                key={p.id} 
                onClick={() => { onChange(p.id); setIsOpen(false); }} 
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded flex items-center gap-2 text-gray-800"
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }}></span>
                <span className="truncate">{p.name}</span>
              </button>
            ))}
            {showCreateOption && onAddProject && (
              <button 
                onClick={handleCreate}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-blue-600 rounded flex items-center gap-2 font-medium"
              >
                <Plus size={14} /> Create "{searchQuery.trim()}"
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
