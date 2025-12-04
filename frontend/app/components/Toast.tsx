"use client";

import { useEffect } from "react";

type ToastType = "success" | "error" | "info" | "warning";

type ToastProps = {
  message: string;
  type?: ToastType;
  onClose: () => void;
  duration?: number; // ms
};

export default function Toast({
  message,
  type = "info",
  onClose,
  duration = 5000,
}: ToastProps) {
  useEffect(() => {
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [onClose, duration]);

  const base =
    "fixed top-4 right-4 z-50 max-w-sm rounded-xl shadow-lg px-4 py-3 text-sm flex items-start space-x-3 border";

  const typeClasses =
    type === "success"
      ? "bg-green-50 text-green-800 border-green-300"
      : type === "error"
      ? "bg-red-50 text-red-800 border-red-300"
      : type === "warning"
      ? "bg-yellow-50 text-yellow-800 border-yellow-300"
      : "bg-blue-50 text-blue-800 border-blue-300";

  const iconClass =
    type === "success"
      ? "fas fa-check-circle"
      : type === "error"
      ? "fas fa-exclamation-circle"
      : type === "warning"
      ? "fas fa-exclamation-triangle"
      : "fas fa-info-circle";

  return (
    <div className={`${base} ${typeClasses}`}>
      <i className={`${iconClass} mt-0.5`} />
      <div className="flex-1">
        <p className="font-semibold capitalize mb-0.5">{type}</p>
        <p className="text-xs leading-snug">{message}</p>
      </div>
      <button
        className="ml-2 text-xs font-semibold opacity-70 hover:opacity-100"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
