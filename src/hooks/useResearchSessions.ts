import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ResearchSession } from "../types";

export interface ResearchTask {
    id: string;
    sessionId: string;
    query: string;
    status: "running" | "completed" | "failed" | "cancelled";
    result?: string;
    error?: string;
    startedAt: number;
    completedAt?: number;
}

interface ChatResponse {
    content: string;
    rawJson: string;
    inputTokens: number;
    outputTokens: number;
}

const STORAGE_KEY = "research-sessions";

function generateSessionId() {
    return `research-session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createDefaultSession(): ResearchSession {
    return {
        id: generateSessionId(),
        name: "Research 1",
        createdAt: Date.now(),
    };
}

export function useResearchSessions() {
    const [sessions, setSessions] = useState<ResearchSession[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error("Failed to load research sessions:", e);
        }
        return [createDefaultSession()];
    });

    const [activeSessionId, setActiveSessionId] = useState<string>(() => {
        return sessions[0]?.id || "";
    });

    const [tasks, setTasks] = useState<ResearchTask[]>(() => {
        try {
            const saved = localStorage.getItem(`${STORAGE_KEY}-tasks`);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.error("Failed to load research tasks:", e);
        }
        return [];
    });

    // Persist sessions
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    }, [sessions]);

    // Persist tasks
    useEffect(() => {
        localStorage.setItem(`${STORAGE_KEY}-tasks`, JSON.stringify(tasks));
    }, [tasks]);

    const createSession = useCallback(() => {
        const newSession: ResearchSession = {
            id: generateSessionId(),
            name: `Research ${sessions.length + 1}`,
            createdAt: Date.now(),
        };
        setSessions((prev) => [...prev, newSession]);
        setActiveSessionId(newSession.id);
    }, [sessions.length]);

    const deleteSession = useCallback(
        (id: string) => {
            if (sessions.length <= 1) return;

            setSessions((prev) => prev.filter((s) => s.id !== id));
            setTasks((prev) => prev.filter((t) => t.sessionId !== id));

            if (activeSessionId === id) {
                const remaining = sessions.filter((s) => s.id !== id);
                setActiveSessionId(remaining[0]?.id || "");
            }
        },
        [sessions, activeSessionId]
    );

    const renameSession = useCallback((id: string, name: string) => {
        setSessions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, name } : s))
        );
    }, []);

    const startResearch = useCallback(
        async (query: string, apiKey: string, timeoutMinutes?: number) => {
            const taskId = `research-${Date.now()}`;

            // Add task as running
            setTasks((prev) => [
                ...prev,
                {
                    id: taskId,
                    sessionId: activeSessionId,
                    query,
                    status: "running",
                    startedAt: Date.now(),
                },
            ]);

            // Run the research in background (non-blocking)
            invoke<ChatResponse>("deep_research", {
                prompt: query,
                apiKey,
                timeoutMinutes: timeoutMinutes || 60
            })
                .then((response) => {
                    setTasks((prev) =>
                        prev.map((t) =>
                            t.id === taskId && t.status === "running"
                                ? {
                                    ...t,
                                    status: "completed" as const,
                                    result: response.content,
                                    completedAt: Date.now(),
                                }
                                : t
                        )
                    );
                })
                .catch((error) => {
                    const errorMsg =
                        error instanceof Error ? error.message : String(error);
                    setTasks((prev) =>
                        prev.map((t) =>
                            t.id === taskId && t.status === "running"
                                ? {
                                    ...t,
                                    status: "failed" as const,
                                    error: errorMsg,
                                    completedAt: Date.now(),
                                }
                                : t
                        )
                    );
                });

            return taskId;
        },
        [activeSessionId]
    );

    const cancelTask = useCallback((taskId: string) => {
        setTasks((prev) =>
            prev.map((t) =>
                t.id === taskId && t.status === "running"
                    ? {
                        ...t,
                        status: "cancelled" as const,
                        error: "Cancelled by user",
                        completedAt: Date.now(),
                    }
                    : t
            )
        );
    }, []);

    const dismissTask = useCallback((taskId: string) => {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
    }, []);

    const clearCompleted = useCallback(() => {
        setTasks((prev) =>
            prev.filter((t) => t.sessionId !== activeSessionId || t.status === "running")
        );
    }, [activeSessionId]);

    // Get tasks for active session
    const sessionTasks = tasks.filter((t) => t.sessionId === activeSessionId);
    const runningTasks = sessionTasks.filter((t) => t.status === "running");
    const completedTasks = sessionTasks.filter((t) => t.status !== "running");

    return {
        sessions,
        activeSessionId,
        setActiveSessionId,
        createSession,
        deleteSession,
        renameSession,
        tasks: sessionTasks,
        runningTasks,
        completedTasks,
        startResearch,
        cancelTask,
        dismissTask,
        clearCompleted,
    };
}
