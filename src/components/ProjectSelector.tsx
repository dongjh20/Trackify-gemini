import React, { useState, useRef, useEffect } from 'react';
import { Folder, PlusCircle, Plus } from 'lucide-react';
import { Project } from '../types';

interface Props {
  projects: Project[];
  selectedProjectId: string | null;
  onChange: (id: string | null) => void;
  onAddProject?: (name: string, color: string) => void;
  onReorder?: (draggedId: string, targetId: string) => void;
  compact?: boolean;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4'];

export function ProjectSelector({ projects, selectedProjectId, onChange, onAddProject, onReorder, compact = false }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const selected = projects.find(p => p.id === selectedProjectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    
    function handleScroll(event: Event) {
      // Don't close if scrolling inside the dropdown itself
      const target = event.target as HTMLElement;
      if (target && target.closest && target.closest('.project-dropdown-menu')) return;
      setIsOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true); // Use capture phase to catch all scrolls
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 10;
      const spaceAbove = rect.top - 10;
      const dropdownWidth = 224; // w-56 is 224px
      
      let left = rect.left;
      if (left + dropdownWidth > window.innerWidth) {
        left = window.innerWidth - dropdownWidth - 10;
      }
      
      // If there's more space below or at least 250px below, show it below
      if (spaceBelow >= 250 || spaceBelow > spaceAbove) {
        setDropdownStyle({
          position: 'fixed',
          top: rect.bottom + 4,
          left: left,
          width: `${dropdownWidth}px`,
          maxHeight: Math.max(200, spaceBelow - 10) + 'px'
        });
      } else {
        // Show above
        setDropdownStyle({
          position: 'fixed',
          bottom: window.innerHeight - rect.top + 4,
          left: left,
          width: `${dropdownWidth}px`,
          maxHeight: Math.max(200, spaceAbove - 10) + 'px'
        });
      }
    } else {
      setSearchQuery('');
    }
  }, [isOpen, projects.length]);

  const filteredProjects = projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const showCreateOption = searchQuery.trim().length > 0 && !projects.some(p => p.name.toLowerCase() === searchQuery.trim().toLowerCase());

  const handleCreate = () => {
    if (onAddProject && searchQuery.trim()) {
      const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      onAddProject(searchQuery.trim(), randomColor);
      setIsOpen(false);
    }
  };

  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedProjectId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedProjectId || draggedProjectId === targetId) return;
    
    if (onReorder) {
      onReorder(draggedProjectId, targetId);
    }
    setDraggedProjectId(null);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button 
        ref={buttonRef}
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
        <div 
          className="project-dropdown-menu bg-white border border-gray-200 rounded-lg shadow-xl z-[100] flex flex-col"
          style={dropdownStyle}
        >
          <div className="p-2 border-b border-gray-100 flex-shrink-0">
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
          <div className="overflow-y-auto p-1 flex-1">
            <button 
              onClick={() => { onChange(null); setIsOpen(false); }} 
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded flex items-center gap-2 text-gray-600"
            >
              <Folder size={14} /> No project
            </button>
            <div className="h-px bg-gray-100 my-1"></div>
            {filteredProjects.map(p => (
              <div 
                key={p.id}
                draggable={!!onReorder && searchQuery === ''}
                onDragStart={(e) => handleDragStart(e, p.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, p.id)}
                className={`${draggedProjectId === p.id ? 'opacity-50' : ''}`}
              >
                <button 
                  onClick={() => { onChange(p.id); setIsOpen(false); }} 
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded flex items-center gap-2 text-gray-800 ${!!onReorder && searchQuery === '' ? 'cursor-move' : ''}`}
                >
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }}></span>
                  <span className="truncate">{p.name}</span>
                </button>
              </div>
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
