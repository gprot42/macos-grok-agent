import { SelectHTMLAttributes, forwardRef } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, options, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-base text-gray-600 dark:text-tokyo-muted">
            {label}
          </label>
        )}
        <select
          ref={ref}
          className={`px-3 py-2 bg-white dark:bg-tokyo-surface border border-gray-200 dark:border-tokyo-border rounded-lg text-gray-700 dark:text-tokyo-text text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer ${className}`}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
);

Select.displayName = "Select";
