"use client";

export default function InlineLoader({
  label = "Loading…",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-4 ${className}`}>
      <span
        className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-gray-700 animate-spin"
        aria-hidden="true"
      />
      <span className="text-sm text-gray-500">{label}</span>
    </div>
  );
}
