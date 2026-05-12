import { TextareaHTMLAttributes, forwardRef, useEffect, useRef } from "react";

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  autoResize?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className = "", label, autoResize = false, onChange, ...props }, ref) => {
    const internalRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || internalRef;

    useEffect(() => {
      if (autoResize && textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }, [props.value, autoResize, textareaRef]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoResize) {
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }
      onChange?.(e);
    };

    return (
      <div className="flex flex-col gap-1 w-full">
        {label && (
          <label className="text-sm text-gray-600 dark:text-tokyo-muted">
            {label}
          </label>
        )}
        <textarea
          ref={textareaRef}
          className={`px-4 py-3 bg-white dark:bg-tokyo-surface border border-gray-200 dark:border-tokyo-border rounded-lg text-gray-800 dark:text-tokyo-text text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none min-h-[80px] scrollbar-thin ${className}`}
          onChange={handleChange}
          {...props}
        />
      </div>
    );
  }
);

TextArea.displayName = "TextArea";
