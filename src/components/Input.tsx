import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, type = "text", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-sm text-gray-600 dark:text-tokyo-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          type={type}
          className={`px-3 py-2 bg-white dark:bg-tokyo-surface border border-gray-200 dark:border-tokyo-border rounded-lg text-gray-700 dark:text-tokyo-text text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${className}`}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = "Input";
