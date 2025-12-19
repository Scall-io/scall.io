"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type BaseValue = string | number;

export type SelectMenuOption<T extends BaseValue> = {
  value: T;
  label: string;
  subLabel?: string;
  rightLabel?: string;
  disabled?: boolean;
};

type Props<T extends BaseValue> = {
  label?: string;
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
};

export default function SelectMenu<T extends BaseValue>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
  className = "",
  buttonClassName = "",
  menuClassName = "",
}: Props<T>) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        btnRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
      if (!open) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = Math.min(prev + 1, options.length - 1);
          return next;
        });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const opt = options[activeIndex];
        if (opt && !opt.disabled) {
          onChange(opt.value);
          setOpen(false);
          btnRef.current?.focus();
        }
      }
    };

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, options, activeIndex, onChange]);

  // When opening: set activeIndex on current selection
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, options, value]);

  return (
    <div className={`w-full ${className}`}>
      {label ? (
        <label
          htmlFor={id}
          className="mb-3 flex items-center text-sm text-gray-600"
        >
          {label}
        </label>
      ) : null}

      <div className="relative">
        <button
          ref={btnRef}
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (disabled) return;
            setOpen((v) => !v);
          }}
          className={[
            "w-full rounded-xl border border-gray-300 bg-white px-4 py-4 text-left transition",
            "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "flex items-center justify-between gap-3",
            buttonClassName,
          ].join(" ")}
        >
          <div className="min-w-0">
            <div className="truncate font-semibold text-gray-900">
              {selected?.label ?? placeholder}
            </div>
            {selected?.subLabel ? (
              <div className="truncate text-xs text-gray-500">
                {selected.subLabel}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {selected?.rightLabel ? (
              <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                {selected.rightLabel}
              </span>
            ) : null}

            <svg
              className={[
                "h-4 w-4 text-gray-400 transition-transform",
                open ? "rotate-180" : "",
              ].join(" ")}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.936a.75.75 0 111.08 1.04l-4.24 4.5a.75.75 0 01-1.08 0l-4.24-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </button>

        {open ? (
          <div
            ref={menuRef}
            role="listbox"
            className={[
              "absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl",
              "max-h-72 overflow-y-auto",
              menuClassName,
            ].join(" ")}
          >
            {options.map((opt, idx) => {
              const isActive = idx === activeIndex;
              const isSelected = opt.value === value;

              return (
                <button
                  key={`${String(opt.value)}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={!!opt.disabled}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setOpen(false);
                    btnRef.current?.focus();
                  }}
                  className={[
                    "w-full px-4 py-3 text-left transition flex items-start justify-between gap-3",
                    opt.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                    isActive ? "bg-gray-50" : "bg-white",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-gray-900">
                      {opt.label}
                    </div>
                    {opt.subLabel ? (
                      <div className="truncate text-xs text-gray-500">
                        {opt.subLabel}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {opt.rightLabel ? (
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                        {opt.rightLabel}
                      </span>
                    ) : null}

                    {isSelected ? (
                      <svg
                        className="h-4 w-4 text-primary"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 5.29a1 1 0 010 1.42l-7.2 7.2a1 1 0 01-1.42 0l-3.2-3.2a1 1 0 011.42-1.42l2.49 2.49 6.49-6.49a1 1 0 011.42 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
