import type { ReactNode } from 'react'
import { useStagedGate } from './stage'

/** Mounts its children in their own turn of the staged first load (see
    stage.ts); immediately once the room has been revealed. `last` waits
    for every other turn — for bakes that must see the whole room. */
export default function Staged({ id, last = false, children }: { id: string; last?: boolean; children: ReactNode }) {
  return useStagedGate(id, last) ? <>{children}</> : null
}
