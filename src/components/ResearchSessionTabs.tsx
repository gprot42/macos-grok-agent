import { useState } from "react";
import { ResearchSession } from "../types";

interface ResearchSessionTabsProps {
    sessions: ResearchSession[];
    activeSessionId: string;
    onSelectSession: (id: string) => void;
    onCreateSession: () => void;
    onDeleteSession: (id: string) => void;
    onRenameSession: (id: string, name: string) => void;
}

export function ResearchSessionTabs({
    sessions,
    activeSessionId,
    onSelectSession,
    onCreateSession,
    onDeleteSession,
    onRenameSession,
}: ResearchSessionTabsProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");

    const handleRightClick = (e: React.MouseEvent, session: ResearchSession) => {
        e.preventDefault();
        setEditingId(session.id);
        setEditName(session.name);
    };

    const handleRenameSubmit = (id: string) => {
        if (editName.trim()) {
            onRenameSession(id, editName.trim());
        }
        setEditingId(null);
    };

    return (
        <div className="flex items-center gap-1 px-4 py-2 theme-surface border-b theme-border overflow-x-auto">
            {sessions.map((session) => (
                <div
                    key={session.id}
                    className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors ${activeSessionId === session.id
                            ? "theme-accent-bg text-white"
                            : "theme-hover theme-text"
                        }`}
                    onClick={() => onSelectSession(session.id)}
                    onContextMenu={(e) => handleRightClick(e, session)}
                >
                    {editingId === session.id ? (
                        <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => handleRenameSubmit(session.id)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenameSubmit(session.id);
                                if (e.key === "Escape") setEditingId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                            className="w-24 px-1 py-0 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white border rounded outline-none"
                        />
                    ) : (
                        <span className="truncate max-w-[100px]">{session.name}</span>
                    )}
                    {sessions.length > 1 && editingId !== session.id && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSession(session.id);
                            }}
                            className={`opacity-0 group-hover:opacity-100 transition-opacity ${activeSessionId === session.id
                                    ? "text-white/70 hover:text-white"
                                    : "theme-text-muted"
                                }`}
                        >
                            <svg
                                className="w-3.5 h-3.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    )}
                </div>
            ))}
            <button
                onClick={onCreateSession}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm theme-text-muted theme-hover transition-colors"
            >
                <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                    />
                </svg>
                New
            </button>
        </div>
    );
}
