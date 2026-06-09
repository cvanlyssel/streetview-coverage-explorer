// Top bar to the right of the sidebar: search field, notifications, user chip.

export function TopBar() {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-white/[0.06] px-6">
      <label className="flex h-10 w-72 items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 text-sm text-zinc-500 focus-within:border-blue-500/60">
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 stroke-zinc-500">
          <circle cx="9" cy="9" r="6" strokeWidth="1.6" />
          <path d="m13.5 13.5 3.5 3.5" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search locations..."
          className="w-full bg-transparent text-zinc-200 outline-none placeholder:text-zinc-500"
        />
      </label>

      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="Notifications"
          className="relative rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current">
            <path
              d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.5 4.8-1.5 4.8h12s-1.5-1.3-1.5-4.8A4.5 4.5 0 0 0 10 3Z"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M8.5 15a1.6 1.6 0 0 0 3 0" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-[#14161c]" />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
            CV
          </div>
          <span className="text-xs font-medium text-zinc-400">CV</span>
        </div>
      </div>
    </header>
  )
}
