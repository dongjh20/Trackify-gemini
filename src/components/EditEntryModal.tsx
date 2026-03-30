import React, { useState, useEffect } from 'react';
import { TimeEntry, Project, ProjectGroup } from '../types';
import { ProjectSelector } from './ProjectSelector';
import { X, Plus } from 'lucide-react';

interface Props {
  entry: TimeEntry;
  projects: Project[];
  projectGroups?: ProjectGroup[];
  onSave: (id: string, updates: Partial<TimeEntry>) => void;
  onClose: () => void;
  onAddProject: (name: string, color: string) => Promise<void>;
}

export function EditEntryModal({ entry, projects, projectGroups = [], onSave, onClose, onAddProject }: Props) {
  const [description, setDescription] = useState(entry.description);
  const [projectId, setProjectId] = useState<string | null>(entry.projectId);
  
  // Format dates for datetime-local input
  const formatForInput = (timestamp: number) => {
    const d = new Date(timestamp);
    // Adjust for local timezone offset
    const tzOffset = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
    return localISOTime;
  };

  const [startTime, setStartTime] = useState(formatForInput(entry.startTime));
  const [endTime, setEndTime] = useState(formatForInput(entry.endTime));
  const [color, setColor] = useState(entry.color || '');
  const [customColors, setCustomColors] = useState<{label: string, value: string, desc: string}[]>(() => {
    const saved = localStorage.getItem('customEntryColors');
    return saved ? JSON.parse(saved) : [];
  });

  const DEFAULT_COLORS = [
    { label: 'None', value: '', desc: '无' },
    { label: 'Red', value: '#fee2e2', desc: '浅红' },
    { label: 'Orange', value: '#ffedd5', desc: '浅橙' },
    { label: 'Yellow', value: '#fef9c3', desc: '浅黄' },
    { label: 'Green', value: '#dcfce7', desc: '浅绿' },
    { label: 'Blue', value: '#dbeafe', desc: '浅蓝' },
    { label: 'Purple', value: '#f3e8ff', desc: '浅紫' },
  ];

  const allColors = [...DEFAULT_COLORS, ...customColors];

  const handleAddCustomColor = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    const newCustom = { label: 'Custom', value: newColor, desc: '自定义' };
    
    if (!allColors.find(c => c.value === newColor)) {
      const updated = [...customColors, newCustom].slice(-5); // Keep last 5 custom colors
      setCustomColors(updated);
      localStorage.setItem('customEntryColors', JSON.stringify(updated));
    }
    setColor(newColor);
  };

  const handleSave = () => {
    const startTimestamp = new Date(startTime).getTime();
    const endTimestamp = new Date(endTime).getTime();
    
    if (endTimestamp < startTimestamp) {
      alert("End time cannot be before start time");
      return;
    }

    onSave(entry.id, {
      description,
      projectId,
      startTime: startTimestamp,
      endTime: endTimestamp,
      duration: endTimestamp - startTimestamp,
      color: color || null
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.target instanceof HTMLButtonElement) {
        // Allow native enter on specific buttons (like cancel or close)
        if (e.target.dataset.action === 'cancel' || e.target.dataset.action === 'close') {
          return;
        }
        // For color buttons, we blur them on click so this shouldn't hit, but if it does, we can save
      }
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 transition-colors duration-300"
      onKeyDown={handleKeyDown}
    >
      <div 
        className="rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh] transition-colors duration-300"
        style={{ backgroundColor: color || '#ffffff' }}
      >
        <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between flex-shrink-0">
          <h3 className="text-lg font-semibold text-gray-800">
            {entry.id === 'new' ? 'Add Manual Entry' : 'Edit Time Entry'}
          </h3>
          <button 
            onClick={onClose} 
            data-action="close"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 flex flex-col gap-4 overflow-y-visible">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input 
              type="text" 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80 focus:bg-white transition-colors"
              placeholder="What were you working on?"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
            <ProjectSelector 
              projects={projects}
              projectGroups={projectGroups}
              selectedProjectId={projectId}
              onChange={setProjectId}
              onAddProject={onAddProject}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input 
                type="datetime-local" 
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80 focus:bg-white transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input 
                type="datetime-local" 
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/80 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Highlight Color</label>
            <div className="flex flex-wrap gap-3">
              {allColors.map((c) => (
                <div key={c.label + c.value} className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    data-action="color"
                    onClick={(e) => {
                      setColor(c.value);
                      e.currentTarget.blur(); // Remove focus so Enter key saves the modal
                    }}
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform ${
                      color === c.value ? 'border-gray-600 scale-110' : 'border-black/10 hover:scale-110'
                    }`}
                    style={{ backgroundColor: c.value || '#ffffff' }}
                    title={c.label}
                  >
                    {c.value === '' && <span className="text-gray-400 text-xs block transform -rotate-45">/</span>}
                  </button>
                  <span className="text-[10px] text-gray-500 font-medium">{c.desc}</span>
                </div>
              ))}
              
              <div className="flex flex-col items-center gap-1">
                <label 
                  className="w-8 h-8 rounded-full border-2 border-dashed border-gray-400 flex items-center justify-center cursor-pointer hover:border-gray-600 hover:scale-110 transition-transform bg-white/50"
                  title="Custom Color"
                >
                  <input 
                    type="color" 
                    className="opacity-0 absolute w-0 h-0" 
                    onChange={handleAddCustomColor}
                    value={color || '#ffffff'}
                  />
                  <Plus size={14} className="text-gray-500" />
                </label>
                <span className="text-[10px] text-gray-500 font-medium">更多</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="px-6 py-4 bg-black/5 flex justify-end gap-3 border-t border-black/5 rounded-b-xl flex-shrink-0">
          <button 
            onClick={onClose}
            data-action="cancel"
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-black/10 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            data-action="save"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
