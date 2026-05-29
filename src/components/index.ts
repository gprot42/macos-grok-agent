// Re-export everything from new feature-based locations.
// Kept for backward compatibility — prefer @features/* imports in new code.
export { Button }           from "@shared/components/Button";
export { Select }           from "@shared/components/Select";
export { TextArea }         from "@shared/components/TextArea";
export { Input }            from "@shared/components/Input";
export { Checkbox }         from "@shared/components/Checkbox";
export { ModelSelector }    from "@shared/components/ModelSelector";
export { ChatPanel }        from "@features/chat/components/ChatPanel";
export { ImageGenerator }   from "@features/image/components/ImageGenerator";
export { Header }           from "@shared/components/Header";
export { SettingsPanel }    from "@features/settings/components/SettingsPanel";
export { ProjectsPanel }    from "@features/projects/components/ProjectsPanel";
export { CodingAgentPanel } from "@features/agents/components/CodingAgentPanel";
export { GrokVoicePanel }   from "@features/voice/components/GrokVoicePanel";
export { GrokVideoPanel }   from "@features/video/components/GrokVideoPanel";
