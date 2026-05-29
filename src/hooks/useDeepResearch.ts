import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DeepResearchPhaseEvent } from "@shared/types";

export interface ResearchTask {
    id: string;
    query: string;
    status: "running" | "completed" | "failed";
    result?: string;
    error?: string;
    phase?: string;
    phaseMessage?: string;
    subQuestions?: string[];
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

    const startResearch = useCallback(async (query: string, apiKey: string, modelId?: string) => {
        const taskId = `research-${Date.now()}`;

        setTasks(prev => [...prev, {
            id: taskId,
            query,
            status: "running",
            startedAt: Date.now(),
        }]);

        // Listen for phase progress events emitted by agent_chain::deep_research
        const unlistenPhase = await listen<DeepResearchPhaseEvent>("deep-research-phase", (event) => {
            if (event.payload.taskId !== taskId) return;
            setTasks(prev => prev.map(t =>
                t.id === taskId
                    ? {
                        ...t,
                        phase: event.payload.phase,
                        phaseMessage: event.payload.message,
                        subQuestions: event.payload.subQuestions ?? t.subQuestions,
                    }
                    : t
            ));
        });

        invoke<ChatResponse>("deep_research", {
            prompt: query,
            apiKey,
            modelId: modelId ?? "grok-4.3",
            publisher: "xai",
            endpoint: "xai",
            taskId,
        })
            .then(response => {
                unlistenPhase();
                setTasks(prev => prev.map(t =>
                    t.id === taskId
                        ? { ...t, status: "completed" as const, result: response.content, completedAt: Date.now() }
                        : t
                ));
            })
            .catch(error => {
                unlistenPhase();
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
