import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ResearchTask {
    id: string;
    query: string;
    status: "running" | "completed" | "failed";
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

export function useDeepResearch() {
    const [tasks, setTasks] = useState<ResearchTask[]>([]);

    const startResearch = useCallback(async (query: string, apiKey: string) => {
        const taskId = `research-${Date.now()}`;

        // Add task as running
        setTasks(prev => [...prev, {
            id: taskId,
            query,
            status: "running",
            startedAt: Date.now(),
        }]);

        // Run the research in background (non-blocking)
        invoke<ChatResponse>("deep_research", { prompt: query, apiKey })
            .then(response => {
                setTasks(prev => prev.map(t =>
                    t.id === taskId
                        ? { ...t, status: "completed" as const, result: response.content, completedAt: Date.now() }
                        : t
                ));
            })
            .catch(error => {
                const errorMsg = error instanceof Error ? error.message : String(error);
                setTasks(prev => prev.map(t =>
                    t.id === taskId
                        ? { ...t, status: "failed" as const, error: errorMsg, completedAt: Date.now() }
                        : t
                ));
            });

        return taskId;
    }, []);

    const dismissTask = useCallback((taskId: string) => {
        setTasks(prev => prev.filter(t => t.id !== taskId));
    }, []);

    const clearCompleted = useCallback(() => {
        setTasks(prev => prev.filter(t => t.status === "running"));
    }, []);

    const runningTasks = tasks.filter(t => t.status === "running");
    const completedTasks = tasks.filter(t => t.status !== "running");

    return {
        tasks,
        runningTasks,
        completedTasks,
        startResearch,
        dismissTask,
        clearCompleted,
    };
}
