import { useSyncExternalStore } from 'react'
import { getState, subscribe, type WorkspaceState } from '../core/workspace'

export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore(subscribe, getState, getState)
}
