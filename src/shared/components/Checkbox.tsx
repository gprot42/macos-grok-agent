import { InputHTMLAttributes, forwardRef } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = "", label, id, ...props }, ref) => {
    const checkboxId = id || `checkbox-${label.toLowerCase().replace(/\s+/g, "-")}`;

    return (
      <label
        htmlFor={checkboxId}
        className={`inline-flex items-center gap-2 cursor-pointer select-none ${className}`}
      >
        <input
          ref={ref}
          type="checkbox"
          id={checkboxId}
          className="w-4 h-4 rounded border-gray-300 dark:border-tokyo-border text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 bg-white dark:bg-tokyo-surface cursor-pointer"
          {...props}
        />
        <span className="text-base theme-text">{label}</span>
      </label>
    );
  }
);

Checkbox.displayName = "Checkbox";
