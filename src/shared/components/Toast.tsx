import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in
    const showTimer = setTimeout(() => setVisible(true), 10);
    // Auto-dismiss
    const hideTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, toast.duration ?? 4000);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, [toast.id, toast.duration, onDismiss]);

  const icons = {
    success: <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />,
    error: <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />,
    info: <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />,
  };
  const borders = {
    success: "border-green-200 dark:border-green-800",
    error: "border-red-200 dark:border-red-800",
    info: "border-blue-200 dark:border-blue-800",
  };

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg bg-white dark:bg-tokyo-surface theme-text text-sm max-w-sm transition-all duration-300 ${borders[toast.type]} ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {icons[toast.type]}
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onDismiss(toast.id), 300); }}
        className="theme-text-muted hover:theme-text transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

/** Hook to manage toasts — use in App.tsx and pass down or import directly */
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (message: string, type: ToastType = "info", duration?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  };

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return { toasts, dismiss, toast: addToast };
}
