// Animates a number from 0 to its value on mount (and on value change).

import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'

export function CountUp({
  value,
  format,
  duration = 1.1,
}: {
  value: number
  format: (n: number) => string
  duration?: number
}) {
  const [display, setDisplay] = useState(() => format(0))

  // Latest formatter without restarting the tween when its identity changes
  // (callers pass inline arrows). Declared before the animate effect so it
  // runs first each commit.
  const formatRef = useRef(format)
  useEffect(() => {
    formatRef.current = format
  })

  useEffect(() => {
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(formatRef.current(v)),
    })
    return () => controls.stop()
  }, [value, duration])

  return <>{display}</>
}
